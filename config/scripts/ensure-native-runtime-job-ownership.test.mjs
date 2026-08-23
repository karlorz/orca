import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The shipped Windows app loaded node-pty from `prebuilds/`, whose conpty
 * native exports only startProcess/connect/resize/clear/kill. Every job call
 * returned "unavailable", so pane teardown fell back to the PID-ancestry path
 * the job object replaces and the orphaned-tree fixes were inert in production.
 *
 * The runtime guard that would have caught it exists and never runs (no Windows
 * CI lane for the PTY suites). This pins the build-time guard instead, which
 * does run on every Windows build.
 */
const SOURCE = readFileSync(new URL('./ensure-native-runtime.mjs', import.meta.url), 'utf8')

/** Evaluate the guard in isolation, standing in for the win32 platform check. */
function callGuard({ platform, nativeName, exported }) {
  const body = SOURCE.slice(
    SOURCE.indexOf('function assertNodePtyJobOwnership'),
    SOURCE.indexOf('function assertNodePtyWindowsConptyRuntime')
  )
  const factory = new Function(
    'process',
    'NODE_PTY_JOB_EXPORTS',
    `${body}; return assertNodePtyJobOwnership`
  )
  const guard = factory({ platform }, ['listJobProcessIds', 'terminateJob', 'assignCurrentProcessToJob'])
  guard(nativeName, exported)
}

const PATCHED = {
  dir: 'build/Release/',
  module: {
    listJobProcessIds: () => [],
    terminateJob: () => true,
    assignCurrentProcessToJob: () => true
  }
}
const PREBUILD = {
  dir: 'prebuilds/win32-x64/',
  module: { startProcess: () => {}, connect: () => {}, resize: () => {}, clear: () => {}, kill: () => {} }
}

describe('assertNodePtyJobOwnership', () => {
  it('rejects the prebuild that shipped without the job exports', () => {
    expect(() => callGuard({ platform: 'win32', nativeName: 'conpty', exported: PREBUILD })).toThrow(
      /listJobProcessIds, terminateJob, assignCurrentProcessToJob/
    )
  })

  it('names where the bad native came from, so the fix is obvious', () => {
    expect(() => callGuard({ platform: 'win32', nativeName: 'conpty', exported: PREBUILD })).toThrow(
      /prebuilds\/win32-x64/
    )
  })

  it('accepts a source build carrying the patch', () => {
    expect(() => callGuard({ platform: 'win32', nativeName: 'conpty', exported: PATCHED })).not.toThrow()
  })

  it.each([
    ['non-Windows hosts', { platform: 'darwin', nativeName: 'pty' }],
    ['the pre-ConPTY winpty backend', { platform: 'win32', nativeName: 'pty' }]
  ])('stays out of the way on %s', (_case, spec) => {
    expect(() => callGuard({ ...spec, exported: PREBUILD })).not.toThrow()
  })
})
