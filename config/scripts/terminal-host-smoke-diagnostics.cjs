const { openSync, closeSync, fstatSync, readSync, constants } = require('node:fs')
const { basename } = require('node:path')

const MAX_TAIL_BYTES = 16 * 1024
const MAX_EVENTS = 24
const LOG_EVENTS = new Set([
  'startup',
  'ready',
  'macos-login-preflight',
  'macos-tcc-pty-spawn',
  'startup-command-delivery',
  'startup-command-stage-failed',
  'shell-ready-timeout',
  'shell-ready-wrapper-replaced',
  'session-created',
  'session-exited',
  'client-request-failed',
  'uncaught-exception-suppressed',
  'uncaught-exception-fatal',
  'shutdown',
  'shutdown-error',
  'daemon-log-closed'
])
const SAFE_WORDS = new Set([
  'bash',
  'zsh',
  'fish',
  'sh',
  'unknown',
  'pending',
  'ready',
  'unsupported',
  'timed_out',
  'accepted',
  'rejected',
  'timeout',
  'error',
  'wrapped',
  'direct',
  'SIGTERM',
  'SIGKILL',
  'SIGINT',
  'idle'
])
const NUMBER_FIELDS = ['pid', 'code', 'protocolVersion', 'timeoutMs', 'commandLength']
const BOOL_FIELDS = ['ok', 'written', 'hasCommand', 'viaShellArgs', 'queuedByShellReadyBarrier']
const WORD_FIELDS = ['shell', 'reason', 'strategy']

function readLogTail(path) {
  let fd
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK)
    const stat = fstatSync(fd)
    if (!stat.isFile()) {
      return { status: 'unavailable' }
    }
    const size = stat.size
    const start = Math.max(0, size - MAX_TAIL_BYTES)
    const bytes = Buffer.alloc(Math.min(size, MAX_TAIL_BYTES))
    const count = readSync(fd, bytes, 0, bytes.length, start)
    const text = bytes.subarray(0, count).toString('utf8')
    const lines = text.split('\n')
    if (start > 0) {
      lines.shift()
    }
    const events = []
    for (const line of lines) {
      try {
        const record = JSON.parse(line)
        if (!LOG_EVENTS.has(record?.event)) {
          continue
        }
        const safe = { event: record.event }
        for (const field of NUMBER_FIELDS) {
          if (Number.isSafeInteger(record[field])) {
            safe[field] = record[field]
          }
        }
        for (const field of BOOL_FIELDS) {
          if (typeof record[field] === 'boolean') {
            safe[field] = record[field]
          }
        }
        for (const field of WORD_FIELDS) {
          if (SAFE_WORDS.has(record[field])) {
            safe[field] = record[field]
          }
        }
        events.push(safe)
      } catch {
        // A partial NDJSON write supplies no usable evidence.
      }
    }
    return { status: 'captured', bytesRead: count, events: events.slice(-MAX_EVENTS) }
  } catch {
    return { status: 'unavailable' }
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd)
      } catch {
        /* Diagnostics are best-effort. */
      }
    }
  }
}

function createTerminalHostSmokeDiagnostics(logPath, requestedShell) {
  const startedAt = Date.now()
  const stages = []
  let stderrBytes = 0
  let stderrTail = ''
  let streamBytes = 0
  let streamEvents = 0
  let createAck = 'missing'
  let shellState = 'unknown'
  let daemonExit = null
  let ptyExit = null
  const shell = basename(requestedShell || '/bin/zsh')
  return {
    stage(name) {
      stages.push({ stage: name, elapsedMs: Date.now() - startedAt })
      if (stages.length > MAX_EVENTS) {
        stages.shift()
      }
    },
    stderr(chunk) {
      stderrBytes += Buffer.byteLength(chunk)
      stderrTail = (stderrTail + chunk).slice(-MAX_TAIL_BYTES)
    },
    stream(message) {
      streamEvents++
      if (message?.event === 'data' && typeof message.payload?.data === 'string') {
        if (streamBytes === 0 && message.payload.data.length > 0) {
          this.stage('first-stream-data')
        }
        streamBytes += Buffer.byteLength(message.payload.data)
      }
      if (message?.event === 'exit') {
        this.stage('pty-exit-received')
        ptyExit = {
          code: Number.isSafeInteger(message.payload?.code) ? message.payload.code : null
        }
      }
    },
    ack(message) {
      createAck = message.ok === true ? 'accepted' : 'rejected'
      this.stage(`create-${createAck}`)
      if (SAFE_WORDS.has(message.payload?.shellState)) {
        shellState = message.payload.shellState
      }
    },
    exit(code, signal) {
      daemonExit = {
        code: Number.isSafeInteger(code) ? code : null,
        signal: SAFE_WORDS.has(signal) ? signal : null
      }
    },
    snapshot() {
      return JSON.stringify({
        requestedShell: SAFE_WORDS.has(shell) ? shell : 'custom',
        elapsedMs: Date.now() - startedAt,
        stages,
        createAck,
        shellState,
        streamEvents,
        streamBytes,
        daemonExit,
        ptyExit,
        stderr: {
          bytes: stderrBytes,
          moduleLoadFailure: /MODULE_NOT_FOUND|Cannot find module/.test(stderrTail),
          wrapperWriteFailure: /Failed to write shell wrapper files/.test(stderrTail),
          loginPreflightFailure: /macOS login\(1\) preflight failed/.test(stderrTail)
        },
        daemonLog: readLogTail(logPath)
      })
    }
  }
}

module.exports = { createTerminalHostSmokeDiagnostics }
