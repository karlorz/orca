import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import type { ElectronApplication } from '@stablyai/playwright-test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { closeElectronAppForE2E, readDaemonPidFiles } from './electron-process-shutdown'

function exitedAppFixture() {
  const proc = Object.assign(new EventEmitter(), {
    exitCode: null as number | null,
    signalCode: null,
    stdio: [new PassThrough(), new PassThrough(), new PassThrough()]
  })
  const pipesClosed = Promise.all(
    proc.stdio.map((stream) => new Promise<void>((resolve) => stream.once('close', resolve)))
  )
  const close = vi.fn(() => pipesClosed)
  const app = {
    process: () => proc as unknown as ChildProcess,
    close
  } as unknown as ElectronApplication
  return { proc, app, close }
}

afterEach(() => vi.useRealTimers())

describe('Electron shutdown with inherited pipes', () => {
  it('releases retained pipes only after Electron exits, settling Playwright cleanup', async () => {
    const { proc, app, close } = exitedAppFixture()
    const closing = closeElectronAppForE2E(app)
    expect(close).toHaveBeenCalledOnce()
    expect(proc.stdio.every((stream) => !stream.destroyed)).toBe(true)
    proc.exitCode = 0
    proc.emit('exit', 0, null)
    await closing
    expect(proc.stdio.every((stream) => stream.destroyed)).toBe(true)
    expect(proc.listenerCount('exit')).toBe(0)
  })

  it('releases pipes when Electron already exited before cleanup starts', async () => {
    const { proc, app } = exitedAppFixture()
    proc.exitCode = 0
    await closeElectronAppForE2E(app)
    expect(proc.stdio.every((stream) => stream.destroyed)).toBe(true)
  })

  it('does not release pipes if shutdown times out without confirmed process exit', async () => {
    vi.useFakeTimers()
    const { proc, app } = exitedAppFixture()
    const closing = closeElectronAppForE2E(app)
    await vi.advanceTimersByTimeAsync(10_000)
    await closing
    expect(proc.stdio.every((stream) => !stream.destroyed)).toBe(true)
    expect(proc.listenerCount('exit')).toBe(0)
    for (const stream of proc.stdio) {
      stream.destroy()
    }
  })
})

describe('daemon pid cleanup files', () => {
  const directories: string[] = []
  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  function profileWithDaemon(entries: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), 'orca-daemon-pid-'))
    directories.push(root)
    mkdirSync(join(root, 'daemon'))
    for (const [name, body] of Object.entries(entries)) {
      writeFileSync(join(root, 'daemon', name), body)
    }
    return root
  }

  it('reads JSON and legacy integer pid files and ignores a vanished leftover', () => {
    const root = profileWithDaemon({
      'daemon-v44.pid': '{"pid":4242}\n',
      'daemon-v43.pid': '4243\n',
      'notes.txt': 'not a pid'
    })
    mkdirSync(join(root, 'daemon', 'daemon-v1.pid'))
    expect(readDaemonPidFiles(root).sort((a, b) => a - b)).toEqual([4242, 4243])
  })

  it('does not throw when a listed pid file cannot be read', () => {
    const root = profileWithDaemon({})
    const listed = join(root, 'daemon', 'daemon-v44.pid')
    try {
      symlinkSync(join(root, 'gone.pid'), listed)
    } catch {
      mkdirSync(listed)
    }
    expect(readDaemonPidFiles(root)).toEqual([])
  })
})
