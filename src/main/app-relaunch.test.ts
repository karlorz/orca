import path from 'node:path'
import { tmpdir } from 'node:os'
import { appImageNamespaceKey } from '../shared/appimage-cache-identity'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { appRelaunchMock, hasSwitchMock, recordDurableCrashBreadcrumbMock, packageTypeMock } =
  vi.hoisted(() => ({
    packageTypeMock: vi.fn(() => 'non-root'),
    appRelaunchMock: vi.fn(),
    hasSwitchMock: vi.fn<(name: string) => boolean>(() => false),
    recordDurableCrashBreadcrumbMock: vi.fn()
  }))

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getPath: () => path.join(tmpdir(), 'orca-relaunch-home'),
    relaunch: appRelaunchMock,
    commandLine: { hasSwitch: hasSwitchMock }
  }
}))
vi.mock('./linux-update-package-type', () => ({ getLinuxPackageType: packageTypeMock }))
vi.mock('./windows/windows-administrator-status', () => ({
  getWindowsAdministratorStatus: vi.fn(async () => true)
}))
vi.mock('./daemon/daemon-provider-restart', () => ({ restartDaemon: vi.fn(async () => {}) }))
vi.mock('./crash-reporting/durable-crash-breadcrumb', () => ({
  recordDurableCrashBreadcrumb: recordDurableCrashBreadcrumbMock
}))

import { relaunchApp } from './app-relaunch'
import { restartLocalTerminalsAfterElevation } from './windows/windows-administrator-restart'
import { _resetHydrateShellPathCache, _setLaunchPathForTests } from './startup/hydrate-shell-path'

beforeEach(() => {
  packageTypeMock.mockReset().mockReturnValue('non-root')
  vi.stubEnv('APPIMAGE', undefined)
  vi.stubEnv('APPDIR', undefined)
  vi.stubEnv('APPIMAGE_EXTRACT_AND_RUN', undefined)
  vi.stubEnv('ORCA_HOME_INSTALL_MANAGED', undefined)
  appRelaunchMock.mockReset()
  hasSwitchMock.mockReset().mockReturnValue(false)
  recordDurableCrashBreadcrumbMock.mockReset()
})

const originalPath = process.env.PATH
const originalArgv = process.argv

afterEach(() => {
  process.argv = originalArgv
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  _resetHydrateShellPathCache()
  if (originalPath === undefined) {
    delete process.env.PATH
  } else {
    process.env.PATH = originalPath
  }
})

describe('relaunchApp', () => {
  it('does not replay native administrator restart arguments before or after consumption', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const flag = '--orca-restart-local-terminals-as-administrator'
    const nativeArgv = ['Orca.exe', '--user-data-dir=C:\\Orca profile', flag]
    process.argv = [...nativeArgv]
    hasSwitchMock.mockImplementation((name: string) => nativeArgv.includes(`--${name}`))
    let nextArgs: string[] | undefined
    appRelaunchMock.mockImplementation((options?: Electron.RelaunchOptions) => {
      nextArgs = options?.args ?? nativeArgv.slice(1)
    })

    relaunchApp('renderer-request')
    expect(nextArgs).toEqual(['--user-data-dir=C:\\Orca profile'])
    await restartLocalTerminalsAfterElevation(new AbortController().signal)
    expect(process.argv).not.toContain(flag)
    expect(nativeArgv).toContain(flag)
    relaunchApp('profile-switch')
    expect(nextArgs).toEqual(['--user-data-dir=C:\\Orca profile'])

    const custom = { execPath: 'administrator-launcher.exe', args: ['restart', flag] }
    relaunchApp('windows-administrator', undefined, custom)
    expect(appRelaunchMock).toHaveBeenLastCalledWith(custom)
  })

  it.each(['win32', 'darwin', 'linux'] as const)(
    'preserves default relaunch arguments for ordinary %s launches',
    (platform) => {
      vi.spyOn(process, 'platform', 'get').mockReturnValue(platform)
      relaunchApp('renderer-request')
      expect(appRelaunchMock).toHaveBeenCalledWith(undefined)
    }
  )
  it('passes the native restart target to Electron after recording the reason', () => {
    const options = { execPath: 'C:\\Orca\\resources\\bin\\orca.exe', args: ['restart'] }
    relaunchApp('windows-administrator', undefined, options)
    expect(appRelaunchMock).toHaveBeenCalledWith(options)
    expect(recordDurableCrashBreadcrumbMock.mock.invocationCallOrder[0]).toBeLessThan(
      appRelaunchMock.mock.invocationCallOrder[0]
    )
  })
  it('durably records the reason before scheduling the replacement process', () => {
    relaunchApp('gpu-fallback', { processReason: 'crashed', exitCode: 5 })

    expect(recordDurableCrashBreadcrumbMock).toHaveBeenCalledOnce()
    expect(recordDurableCrashBreadcrumbMock).toHaveBeenCalledWith('app_relaunch_requested', {
      processReason: 'crashed',
      exitCode: 5,
      reason: 'gpu-fallback'
    })
    expect(appRelaunchMock).toHaveBeenCalledOnce()
    expect(recordDurableCrashBreadcrumbMock.mock.invocationCallOrder[0]).toBeLessThan(
      appRelaunchMock.mock.invocationCallOrder[0]
    )
  })

  it('does not carry Orca PATH seeds into the replacement process', () => {
    process.env.PATH = '/seeded/newest-nvm/bin:/usr/bin'
    _setLaunchPathForTests('/usr/bin')
    let inheritedPath: string | undefined
    appRelaunchMock.mockImplementation(() => {
      inheritedPath = process.env.PATH
    })

    relaunchApp('renderer-request')

    expect(inheritedPath).toBe('/usr/bin')
    expect(process.env.PATH).toBe('/seeded/newest-nvm/bin:/usr/bin')
  })
})

const home = path.join(tmpdir(), 'orca-relaunch-home')
const installedImage = path.join(home, '.local', 'opt', 'orca', 'orca-linux.AppImage')
const profileArgs = ['--user-data-dir=profile with spaces', '--no-sandbox']

function stubCachedLaunch(overrides: Partial<NodeJS.Process> = {}): void {
  vi.stubGlobal('process', {
    ...process,
    platform: 'linux',
    arch: 'x64',
    execPath: path.join(
      home,
      '.cache',
      'orca',
      'appimage',
      appImageNamespaceKey(installedImage),
      'a'.repeat(24),
      'orca-ide'
    ),
    argv: ['old-cached-executable', ...profileArgs],
    ...overrides
  })
}

describe('managed home AppImage relaunch', () => {
  it.each(['gpu-fallback', 'profile-switch', 'profile-transfer', 'renderer-request'] as const)(
    'restarts the installed image from a cached %s launch without launcher variables',
    (reason) => {
      stubCachedLaunch()
      relaunchApp(reason)
      expect(appRelaunchMock).toHaveBeenCalledWith({ execPath: installedImage, args: profileArgs })
      expect(process.env.APPIMAGE_EXTRACT_AND_RUN).toBe('1')
      expect(process.env.ORCA_HOME_INSTALL_MANAGED).toBe('1')
      expect(recordDurableCrashBreadcrumbMock.mock.invocationCallOrder[0]).toBeLessThan(
        appRelaunchMock.mock.invocationCallOrder[0]
      )
    }
  )

  it('preserves explicit profile arguments and the launch PATH', () => {
    stubCachedLaunch()
    process.env.PATH = '/seeded/node/bin:/usr/bin'
    _setLaunchPathForTests('/usr/bin')
    let inheritedPath: string | undefined
    appRelaunchMock.mockImplementation(() => {
      inheritedPath = process.env.PATH
    })
    const args = ['--user-data-dir=another profile', '--disable-gpu']
    relaunchApp('profile-switch', undefined, { args })
    expect(appRelaunchMock).toHaveBeenCalledWith({ execPath: installedImage, args })
    expect(inheritedPath).toBe('/usr/bin')
    expect(process.env.PATH).toBe('/seeded/node/bin:/usr/bin')
  })

  it('preserves existing AppImage runtime settings on a managed launcher restart', () => {
    stubCachedLaunch({ execPath: '/tmp/.mount_orca/orca-ide' })
    vi.stubEnv('APPIMAGE', installedImage)
    vi.stubEnv('ORCA_HOME_INSTALL_MANAGED', '1')
    vi.stubEnv('APPIMAGE_EXTRACT_AND_RUN', '0')
    relaunchApp('renderer-request')
    expect(appRelaunchMock).toHaveBeenCalledWith({ execPath: installedImage, args: profileArgs })
    expect(process.env.APPIMAGE_EXTRACT_AND_RUN).toBe('0')
  })

  it('honors an explicit executable without changing runtime settings', () => {
    stubCachedLaunch()
    const options = { execPath: '/custom/restart-target', args: ['custom argument'] }
    relaunchApp('renderer-request', undefined, options)
    expect(appRelaunchMock).toHaveBeenCalledWith(options)
    expect(process.env.APPIMAGE_EXTRACT_AND_RUN).toBeUndefined()
    expect(process.env.ORCA_HOME_INSTALL_MANAGED).toBeUndefined()
  })

  it.each([
    'darwin',
    'win32',
    'arm64',
    'deb',
    'rpm',
    'unusable',
    'opt-out',
    'conflicting-image',
    'unrelated-executable',
    'custom-root'
  ])('keeps existing restart behavior for %s', (variant) => {
    stubCachedLaunch()
    if (variant === 'darwin' || variant === 'win32') {
      stubCachedLaunch({ platform: variant })
    }
    if (variant === 'arm64') {
      stubCachedLaunch({ arch: 'arm64' })
    }
    if (['deb', 'rpm', 'unusable'].includes(variant)) {
      packageTypeMock.mockReturnValue(variant)
    }
    if (variant === 'opt-out') {
      vi.stubEnv('ORCA_HOME_INSTALL_MANAGED', '0')
    }
    if (variant === 'conflicting-image') {
      vi.stubEnv('APPIMAGE', '/another/orca-linux.AppImage')
    }
    if (variant === 'unrelated-executable') {
      stubCachedLaunch({ execPath: '/opt/Orca/orca-ide' })
    }
    if (variant === 'custom-root') {
      vi.stubEnv('ORCA_HOME_INSTALL_MANAGED', '1')
      vi.stubEnv('APPIMAGE', path.join(home, 'custom', 'orca-linux.AppImage'))
    }
    const options = { args: ['--user-data-dir=unchanged profile'] }
    relaunchApp('profile-switch', undefined, options)
    expect(appRelaunchMock).toHaveBeenCalledWith(options)
    expect(process.env.APPIMAGE_EXTRACT_AND_RUN).toBeUndefined()
  })
})
