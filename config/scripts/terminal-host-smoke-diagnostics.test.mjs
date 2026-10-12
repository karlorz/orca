import { appendFileSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createTerminalHostSmokeDiagnostics } from './terminal-host-smoke-diagnostics.cjs'

const roots = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('terminal-host smoke diagnostics', () => {
  it('captures bounded stage, stream, acknowledgement, exit, and safe daemon-log evidence', () => {
    const root = mkdtempSync(join(tmpdir(), 'terminal-host-diagnostics-'))
    roots.push(root)
    const log = join(root, 'daemon.log')
    writeFileSync(
      log,
      `${JSON.stringify({ event: 'startup', socketPath: '/private/home/secret.sock', pid: 7 })}\n` +
        `${JSON.stringify({ event: 'shell-ready-timeout', shell: 'bash', timeoutMs: 15000 })}\n` +
        `${JSON.stringify({ event: 'ignored', command: 'secret command' })}\n`
    )
    const diagnostics = createTerminalHostSmokeDiagnostics(log, '/bin/bash')
    diagnostics.stage('spawn-requested')
    diagnostics.stage('endpoint-ready')
    diagnostics.ack({ ok: true, payload: { shellState: 'ready' } })
    diagnostics.stream({ event: 'data', payload: { data: 'OK 42' } })
    diagnostics.stream({ event: 'exit', payload: { code: 0, secret: 'private-exit' } })
    diagnostics.exit(0, null)

    const report = JSON.parse(diagnostics.snapshot())
    expect(report.requestedShell).toBe('bash')
    expect(report.createAck).toBe('accepted')
    expect(report.shellState).toBe('ready')
    expect(report.streamBytes).toBe(5)
    expect(report.daemonExit).toEqual({ code: 0, signal: null })
    expect(report.ptyExit).toEqual({ code: 0 })
    expect(report.stages).toContainEqual({
      stage: 'first-stream-data',
      elapsedMs: expect.any(Number)
    })
    expect(diagnostics.snapshot()).not.toContain('private-exit')
    expect(report.daemonLog.events).toEqual([
      { event: 'startup', pid: 7 },
      { event: 'shell-ready-timeout', shell: 'bash', timeoutMs: 15000 }
    ])
    expect(report.daemonLog.events).not.toContainEqual(
      expect.objectContaining({ command: expect.anything() })
    )
  })

  it('withholds profile paths, environment, error text and malformed log lines', () => {
    const root = mkdtempSync(join(tmpdir(), 'terminal-host-diagnostics-'))
    roots.push(root)
    const log = join(root, 'daemon.log')
    writeFileSync(
      log,
      [
        JSON.stringify({
          event: 'uncaught-exception-fatal',
          message: 'private token',
          env: { HOME: '/private/home' }
        }),
        JSON.stringify({
          event: 'shell-ready-timeout',
          shell: '/private/home/custom',
          timeoutMs: 15000
        }),
        JSON.stringify({ event: 'macos-login-preflight', reason: 'private token', ok: false }),
        '{private partial'
      ].join('\n')
    )
    const diagnostics = createTerminalHostSmokeDiagnostics(log, '/private/home/custom')
    diagnostics.stderr('Failed to write shell wrapper files: private token /private/home')
    const report = diagnostics.snapshot()
    expect(report).not.toContain('private')
    expect(JSON.parse(report)).toMatchObject({
      requestedShell: 'custom',
      stderr: { wrapperWriteFailure: true }
    })
  })

  it.each(['x64', 'arm64', 'private-arch', 'x'.repeat(100_000)])(
    'accepts only bounded architecture evidence before cleanup',
    (arch) => {
      const root = mkdtempSync(join(tmpdir(), 'terminal-host-diagnostics-'))
      roots.push(root)
      const probe = join(root, 'bootstrap')
      writeFileSync(probe, arch)
      const diagnostics = createTerminalHostSmokeDiagnostics(join(root, 'log'), '/bin/bash', probe)
      diagnostics.beforeCleanup(join(root, 'socket'), join(root, 'token'), false)
      const report = JSON.parse(diagnostics.snapshot())
      expect(report.bootstrap).toEqual(
        ['x64', 'arm64'].includes(arch)
          ? { status: 'captured', runtimeArch: arch }
          : { status: 'unavailable' }
      )
      expect(diagnostics.snapshot()).not.toContain('private-arch')
    }
  )

  it.skipIf(process.platform === 'win32')(
    'withholds symlinked bootstrap evidence and never reads token contents',
    () => {
      const root = mkdtempSync(join(tmpdir(), 'terminal-host-diagnostics-'))
      roots.push(root)
      const target = join(root, 'private')
      const probe = join(root, 'bootstrap')
      const token = join(root, 'token')
      writeFileSync(target, 'x64')
      symlinkSync(target, probe)
      symlinkSync(target, token)
      const diagnostics = createTerminalHostSmokeDiagnostics(join(root, 'log'), '/bin/bash', probe)
      diagnostics.beforeCleanup(join(root, 'socket'), token, false)
      expect(JSON.parse(diagnostics.snapshot())).toMatchObject({
        bootstrap: { status: 'unavailable' },
        endpoint: { socket: 'missing', token: 'other' }
      })
      expect(diagnostics.snapshot()).not.toContain(root)
    }
  )

  it('keeps log evidence bounded and unavailable logs fail open', () => {
    const root = mkdtempSync(join(tmpdir(), 'terminal-host-diagnostics-'))
    roots.push(root)
    const log = join(root, 'daemon.log')
    appendFileSync(log, `${JSON.stringify({ event: 'ready' })}\n`.repeat(20_000))
    const diagnostics = createTerminalHostSmokeDiagnostics(log, '/bin/zsh')
    const report = JSON.parse(diagnostics.snapshot())

    expect(report.daemonLog.status).toBe('captured')
    expect(report.daemonLog.bytesRead).toBeLessThanOrEqual(16 * 1024)
    expect(report.daemonLog.events).toHaveLength(24)
    expect(
      createTerminalHostSmokeDiagnostics(join(root, 'missing.log'), '/bin/zsh').snapshot()
    ).toContain('"status":"unavailable"')
  })
})
