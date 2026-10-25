import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const {
  assertPackagedDaemonEntryExists,
  runTerminalHostRoundTrip,
  verifyPackagedDaemonEntryBoots,
  verifyPackagedMacTerminalHostBoots
} = require('./verify-packaged-daemon-entry.cjs')

describe('verify-packaged-daemon-entry', () => {
  let resourcesDir

  beforeEach(() => {
    resourcesDir = mkdtempSync(join(tmpdir(), 'orca-daemon-entry-verify-'))
  })

  afterEach(() => {
    rmSync(resourcesDir, { recursive: true, force: true })
  })

  function writePackagedEntry(source) {
    const entryDir = join(resourcesDir, 'app.asar.unpacked', 'out', 'main')
    mkdirSync(entryDir, { recursive: true })
    writeFileSync(join(entryDir, 'daemon-entry.js'), source)
  }

  // Why: a silent skip on a missing entry false-passed exactly the packaged
  // layout regression this gate exists to catch (rc.1 daemon-load incident).
  it('throws when the unpacked daemon entry is missing', () => {
    expect(() => assertPackagedDaemonEntryExists(resourcesDir)).toThrow(
      /missing unpacked daemon entry/
    )
    expect(() => verifyPackagedDaemonEntryBoots(resourcesDir)).toThrow(
      /missing unpacked daemon entry/
    )
  })

  it('passes when the packaged entry loads and reaches argv parsing', () => {
    writePackagedEntry('console.error("Usage: daemon-entry <socket>"); process.exit(1)\n')
    expect(() => verifyPackagedDaemonEntryBoots(resourcesDir)).not.toThrow()
  })

  it('fails when the packaged entry cannot resolve its module graph', () => {
    writePackagedEntry('require("orca-module-that-does-not-exist")\n')
    expect(() => verifyPackagedDaemonEntryBoots(resourcesDir)).toThrow(
      /failed to load under plain Node/
    )
  })

  it('fails when the packaged entry never reaches argv parsing', () => {
    writePackagedEntry('process.exit(0)\n')
    expect(() => verifyPackagedDaemonEntryBoots(resourcesDir)).toThrow(/did not reach argv parsing/)
  })
})

describe('terminal host boot check on a slice this host cannot run', () => {
  // No Mac runs a riscv64 binary, so this is the same path as an x64 slice without Rosetta.
  it('fails a release or CI build', async () => {
    await expect(
      verifyPackagedMacTerminalHostBoots('/Orca.app', { arch: 'riscv64', required: true })
    ).rejects.toThrow(/riscv64 cannot run on this/)
  })

  it('lets a local build skip it', async () => {
    await expect(
      verifyPackagedMacTerminalHostBoots('/Orca.app', { arch: 'riscv64', required: false })
    ).resolves.toBeUndefined()
  })
})

describe.skipIf(process.platform === 'win32')('terminal host round trip', () => {
  let root

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'vpd-'))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    rmSync(root, { recursive: true, force: true })
  })

  // Listens, publishes its token, records its pid, then treats each connection with `onConnection`.
  function fakeDaemon(onConnection) {
    const entry = join(root, 'daemon.cjs')
    writeFileSync(
      entry,
      [
        "const net = require('node:net'), fs = require('node:fs')",
        'const arg = (name) => process.argv[process.argv.indexOf(name) + 1]',
        `fs.writeFileSync(${JSON.stringify(join(root, 'pid'))}, String(process.pid))`,
        `fs.writeFileSync(arg('--log-file'), JSON.stringify({ event: 'startup', socketPath: '/private/secret', protocolVersion: 45 }) + '\\n')`,
        `net.createServer(${onConnection}).listen(arg('--socket'), () => fs.writeFileSync(arg('--token'), 'tok'))`
      ].join('\n')
    )
    return entry
  }

  async function roundTrip(entry, timeoutMs) {
    const startedAt = Date.now()
    let diagnostics
    const error = await runTerminalHostRoundTrip({
      command: [process.execPath],
      entry,
      deadline: startedAt + timeoutMs,
      scratchPrefix: join(root, 'oth-')
    }).then(
      (result) => {
        diagnostics = result
        return null
      },
      (rejection) => {
        const marker = '; diagnostics: '
        diagnostics = JSON.parse(
          rejection.message.slice(rejection.message.lastIndexOf(marker) + marker.length)
        )
        return rejection
      }
    )
    const pid = Number(readFileSync(join(root, 'pid'), 'utf8'))
    let daemonAlive = true
    try {
      process.kill(pid, 0)
    } catch {
      daemonAlive = false
    }
    return {
      error,
      diagnostics,
      elapsedMs: Date.now() - startedAt,
      daemonAlive,
      scratchDirs: readdirSync(root).filter((name) => name.startsWith('oth-'))
    }
  }

  function commandDaemon(mode) {
    return fakeDaemon(`(() => {
      let stream
      return (socket) => {
        let buffer = ''
        socket.on('data', (chunk) => {
          buffer += chunk
          let newline
          while ((newline = buffer.indexOf('\\n')) !== -1) {
            const message = JSON.parse(buffer.slice(0, newline))
            buffer = buffer.slice(newline + 1)
            if (message.type === 'hello') {
              if (message.role === 'stream') stream = socket
              socket.write(JSON.stringify({ ok: true }) + '\\n')
            } else if (message.type === 'createOrAttach') {
              fs.writeFileSync(${JSON.stringify(join(root, 'request'))}, JSON.stringify(message.payload))
              if (${JSON.stringify(mode)} === 'capture-unavailable') {
                fs.unlinkSync(arg('--log-file'))
                fs.mkdirSync(arg('--log-file'))
                socket.write(JSON.stringify({ id: message.id, ok: false, error: 'private original rejection' }) + '\\n')
                continue
              }
              if (${JSON.stringify(mode)} === 'rejected') {
                socket.write(JSON.stringify({ id: message.id, ok: false, error: 'spawn refused' }) + '\\n')
                continue
              }
              if (${JSON.stringify(mode)} === 'unacknowledged') continue
              socket.write(JSON.stringify({ id: message.id, ok: true, payload: { shellState: 'pending' } }) + '\\n')
              fs.appendFileSync(arg('--log-file'), JSON.stringify({ event: 'startup-command-delivery', queuedByShellReadyBarrier: true, command: 'private-command' }) + '\\n')
              if (${JSON.stringify(mode)} === 'silent') fs.appendFileSync(arg('--log-file'), JSON.stringify({ event: 'shell-ready-timeout', shell: 'bash', timeoutMs: 15000 }) + '\\n')
              const emit = (data) => stream.write(JSON.stringify({ type: 'event', event: 'data', payload: { data } }) + '\\n')
              if (${JSON.stringify(mode)} === 'echo') {
                emit(message.payload.command + '\\r\\n')
              } else if (${JSON.stringify(mode)} === 'computed' && message.payload.shellReadySupported === true) {
                const result = require('node:child_process').spawnSync('/bin/bash', ['--noprofile', '--norc', '-c', message.payload.command], { encoding: 'utf8' })
                emit(result.stdout.slice(0, 4))
                emit(result.stdout.slice(4))
              }
            }
          }
        })
      }
    })()`)
  }

  it.each(['socket-only', 'token-only', 'empty-token', 'neither'])(
    'reports %s bootstrap state before cleanup without attributing cleanup SIGTERM to startup',
    async (mode) => {
      const entry = join(root, 'blocked-daemon.cjs')
      writeFileSync(
        entry,
        [
          "const net = require('node:net'), fs = require('node:fs')",
          'const arg = (name) => process.argv[process.argv.indexOf(name) + 1]',
          `fs.writeFileSync(${JSON.stringify(join(root, 'pid'))}, String(process.pid))`,
          `if (${JSON.stringify(mode)} === 'socket-only') net.createServer().listen(arg('--socket'))`,
          `if (${JSON.stringify(mode)} === 'token-only') fs.writeFileSync(arg('--token'), 'private-token')`,
          `if (${JSON.stringify(mode)} === 'empty-token') fs.writeFileSync(arg('--token'), '')`,
          "console.error('private stderr /private/profile token=secret')",
          'setInterval(() => {}, 1000)'
        ].join('\n')
      )
      const result = await roundTrip(entry, 800)
      expect(result.error.message).toContain('endpoint not ready')
      expect(result.diagnostics.bootstrap).toEqual({
        status: 'captured',
        runtimeArch: process.arch
      })
      expect(result.diagnostics.endpoint).toEqual({
        socket: mode === 'socket-only' ? 'socket' : 'missing',
        token:
          mode === 'token-only'
            ? 'nonempty-file'
            : mode === 'empty-token'
              ? 'empty-file'
              : 'missing'
      })
      expect(result.diagnostics.lifecycle).toEqual({
        exitedBeforeCleanup: false,
        stopRequested: true
      })
      expect(result.error.message).not.toMatch(/private stderr|private-token|profile|token=secret/)
      expect(result.daemonAlive).toBe(false)
      expect(result.scratchDirs).toEqual([])
    }
  )

  it('marks Node entry even when the module stalls before creating its daemon log', async () => {
    const entry = join(root, 'stalled-daemon.cjs')
    writeFileSync(
      entry,
      `require('node:fs').writeFileSync(${JSON.stringify(join(root, 'pid'))}, String(process.pid))\n` +
        'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0)'
    )
    const result = await roundTrip(entry, 800)
    expect(result.diagnostics.bootstrap).toEqual({ status: 'captured', runtimeArch: process.arch })
    expect(result.diagnostics.daemonLog).toEqual({ status: 'unavailable' })
    expect(result.diagnostics.endpoint).toEqual({ socket: 'missing', token: 'missing' })
    expect(result.diagnostics.lifecycle).toEqual({
      exitedBeforeCleanup: false,
      stopRequested: true
    })
    expect(result.daemonAlive).toBe(false)
    expect(result.scratchDirs).toEqual([])
  })

  it('distinguishes a spontaneous bootstrap exit from verifier cleanup', async () => {
    const entry = join(root, 'exited-daemon.cjs')
    writeFileSync(
      entry,
      `require('node:fs').writeFileSync(${JSON.stringify(join(root, 'pid'))}, String(process.pid))\nprocess.exit(7)`
    )
    const result = await roundTrip(entry, 1_500)
    expect(result.error.message).toContain('the daemon exited before it was ready')
    expect(result.diagnostics.lifecycle).toEqual({
      exitedBeforeCleanup: true,
      stopRequested: false
    })
    expect(result.diagnostics.daemonExit).toEqual({ code: 7, signal: null })
    expect(result.daemonAlive).toBe(false)
    expect(result.scratchDirs).toEqual([])
  })

  it('preserves direct entry argv and main-module semantics with the bootstrap probe', async () => {
    const entry = commandDaemon('computed')
    writeFileSync(
      entry,
      `${readFileSync(entry, 'utf8')}\nfs.writeFileSync(${JSON.stringify(join(root, 'entry-state'))}, JSON.stringify({ main: require.main === module, entry: process.argv[1] }))`
    )
    const result = await roundTrip(entry, 1_500)
    expect(result.error).toBeNull()
    expect(result.diagnostics.bootstrap).toEqual({ status: 'captured', runtimeArch: process.arch })
    expect(JSON.parse(readFileSync(join(root, 'entry-state'), 'utf8'))).toEqual({
      main: true,
      entry
    })
    expect(result.daemonAlive).toBe(false)
    expect(result.scratchDirs).toEqual([])
  })

  it('requests ready-gated command delivery and accepts split computed output', async () => {
    const result = await roundTrip(commandDaemon('computed'), 1_500)
    expect(result.error).toBeNull()
    expect(result.diagnostics).toMatchObject({ createAck: 'accepted', streamBytes: 6 })
    const request = JSON.parse(readFileSync(join(root, 'request'), 'utf8'))
    expect(request).toMatchObject({
      command: 'echo "OK $((6*7))" && exit',
      shellReadySupported: true
    })
    expect(result.daemonAlive).toBe(false)
    expect(result.scratchDirs).toEqual([])
  })

  it('executes computed output through the real PTY after a profile reads during startup', async () => {
    vi.stubEnv('HOME', root)
    vi.stubEnv('SHELL', '/bin/bash')
    writeFileSync(join(root, '.bash_profile'), 'IFS= read -r -t 0.5 startup_input || true\n')
    const entry = join(root, 'real-daemon.cjs')
    writeFileSync(
      entry,
      [
        `require('node:fs').writeFileSync(${JSON.stringify(join(root, 'pid'))}, String(process.pid))`,
        'delete process.env.VITEST',
        'delete process.env.ORCA_DAEMON_ENTRY_LOAD_CHECK',
        `require(${JSON.stringify(require.resolve('tsx/cjs'))})`,
        `require(${JSON.stringify(join(process.cwd(), 'src/main/daemon/daemon-entry.ts'))})`
      ].join('\n')
    )
    const result = await roundTrip(entry, 5_000)
    expect(result.error).toBeNull()
    expect(result.diagnostics.createAck).toBe('accepted')
    expect(result.diagnostics.shellState).toBe('pending')
    expect(result.diagnostics.daemonLog.events).toContainEqual(
      expect.objectContaining({ event: 'session-created' })
    )
    expect(result.daemonAlive).toBe(false)
    expect(result.scratchDirs).toEqual([])
  })

  it('rejects echoed input without computed output and cleans up by the deadline', async () => {
    const result = await roundTrip(commandDaemon('echo'), 800)
    expect(result.error?.message).toMatch(/timed out waiting for "OK 42" from the PTY/)
    expect(result.diagnostics.streamBytes).toBeGreaterThan(0)
    expect(result.elapsedMs).toBeLessThan(800 + 5_000)
    expect(result.daemonAlive).toBe(false)
    expect(result.scratchDirs).toEqual([])
  })

  it('rejects a missing command delivery and cleans up by the deadline', async () => {
    const result = await roundTrip(commandDaemon('silent'), 800)
    expect(result.error?.message).toMatch(
      /timed out waiting for "OK 42" from the PTY; output: empty; diagnostics:/
    )
    expect(result.diagnostics).toMatchObject({
      createAck: 'accepted',
      shellState: 'pending',
      streamBytes: 0
    })
    expect(result.diagnostics.daemonLog.events).toContainEqual({
      event: 'shell-ready-timeout',
      shell: 'bash',
      timeoutMs: 15000
    })
    expect(result.error.message).not.toContain('private-command')
    expect(result.error.message).not.toContain('/private/secret')
    expect(result.daemonAlive).toBe(false)
    expect(result.scratchDirs).toEqual([])
  })

  it('distinguishes a missing create acknowledgement from an acknowledged empty PTY', async () => {
    const result = await roundTrip(commandDaemon('unacknowledged'), 800)
    expect(result.diagnostics).toMatchObject({ createAck: 'missing', streamBytes: 0 })
    expect(result.daemonAlive).toBe(false)
    expect(result.scratchDirs).toEqual([])
  })

  it('rejects create failure immediately and cleans up', async () => {
    const result = await roundTrip(commandDaemon('rejected'), 5_000)
    expect(result.error?.message).toMatch(/createOrAttach failed/)
    expect(result.diagnostics.createAck).toBe('rejected')
    expect(result.elapsedMs).toBeLessThan(2_000)
    expect(result.daemonAlive).toBe(false)
    expect(result.scratchDirs).toEqual([])
  })

  it('preserves create rejection and cleanup when diagnostic log capture fails', async () => {
    const result = await roundTrip(commandDaemon('capture-unavailable'), 5_000)
    expect(result.error.message).toContain('createOrAttach failed')
    expect(result.error.message).not.toContain('private original rejection')
    expect(result.diagnostics.daemonLog).toEqual({ status: 'unavailable' })
    expect(result.diagnostics.createAck).toBe('rejected')
    expect(result.daemonAlive).toBe(false)
    expect(result.scratchDirs).toEqual([])
  })

  it('rejects by the deadline and cleans up when the daemon never answers the hello', async () => {
    const result = await roundTrip(fakeDaemon('() => {}'), 1_500)
    expect(result.error?.message).toMatch(/timed out waiting for the control hello reply/)
    expect(result.elapsedMs).toBeLessThan(1_500 + 5_000)
    expect(result.daemonAlive).toBe(false)
    expect(result.scratchDirs).toEqual([])
  })

  it('rejects at once and cleans up when the daemon closes the connection', async () => {
    const result = await roundTrip(fakeDaemon('(socket) => socket.destroy()'), 10_000)
    // A destroyed socket may report a clean close, a reset, or a write after close.
    expect(result.error?.message).toMatch(/closed the control connection|ECONNRESET|EPIPE/)
    expect(result.elapsedMs).toBeLessThan(10_000)
    expect(result.daemonAlive).toBe(false)
    expect(result.scratchDirs).toEqual([])
  })

  it('rejects and cleans up when the daemon replies with malformed JSON', async () => {
    const result = await roundTrip(fakeDaemon("(socket) => socket.write('{not json\\n')"), 10_000)
    expect(result.error?.message).toMatch(/non-JSON control line/)
    expect(result.elapsedMs).toBeLessThan(10_000)
    expect(result.daemonAlive).toBe(false)
    expect(result.scratchDirs).toEqual([])
  })
})
