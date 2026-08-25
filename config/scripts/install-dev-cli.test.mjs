import { describe, expect, it, vi } from 'vitest'
import { shouldSkipDevCliInstall, runInstallDevCli } from './install-dev-cli.mjs'

describe('install-dev-cli', () => {
  it('shouldSkipDevCliInstall returns true for "1" or "true", false otherwise', () => {
    expect(shouldSkipDevCliInstall({ ORCA_SKIP_DEV_CLI_INSTALL: '1' })).toBe(true)
    expect(shouldSkipDevCliInstall({ ORCA_SKIP_DEV_CLI_INSTALL: 'true' })).toBe(true)
    expect(shouldSkipDevCliInstall({ ORCA_SKIP_DEV_CLI_INSTALL: '0' })).toBe(false)
    expect(shouldSkipDevCliInstall({ ORCA_SKIP_DEV_CLI_INSTALL: '' })).toBe(false)
    expect(shouldSkipDevCliInstall({})).toBe(false)
  })

  it('skips global symlink when ORCA_SKIP_DEV_CLI_INSTALL is set and does not invoke ln', () => {
    const execFileSync = vi.fn()
    const log = vi.fn()
    const result = runInstallDevCli({
      env: { ORCA_SKIP_DEV_CLI_INSTALL: '1' },
      execFileSync,
      log
    })

    expect(result.outcome).toBe('skipped-env')
    expect(execFileSync).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(
      '[orca-dev] Skipping global symlink (ORCA_SKIP_DEV_CLI_INSTALL).'
    )
  })

  it('skips global symlink on unsupported platforms (e.g. win32)', () => {
    const execFileSync = vi.fn()
    const log = vi.fn()
    const result = runInstallDevCli({
      platform: 'win32',
      execFileSync,
      log
    })

    expect(result.outcome).toBe('skipped-platform')
    expect(execFileSync).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith('[orca-dev] Skipping global symlink (unsupported platform).')
  })
})
