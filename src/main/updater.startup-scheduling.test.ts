import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadUpdaterModule, warmUpdaterModule } from './updater-test-module-loader'
import { appImageNamespaceKey } from '../shared/appimage-cache-identity'

const {
  appMock,
  autoUpdaterMock,
  powerMonitorOnMock,
  fetchNudgeMock,
  shouldApplyNudgeMock,
  moduleFactories,
  resetUpdaterMocks
} = await vi.hoisted(async () => (await import('./updater-test-harness')).createUpdaterMocks())

vi.mock('electron', () => moduleFactories.electron())
vi.mock('electron-updater', () => moduleFactories.electronUpdater())
vi.mock('./electron-updater-loader', () => moduleFactories.electronUpdaterLoader())
vi.mock('./ipc/pty/kill-all', () => moduleFactories.ptyKillAll())
vi.mock('./linux-update-package-type', () => moduleFactories.linuxUpdatePackageType())
vi.mock('./updater-lifecycle-diagnostics', () => moduleFactories.updaterLifecycleDiagnostics())
vi.mock('./updater-changelog', () => moduleFactories.updaterChangelog())
vi.mock('./updater-nudge', () => moduleFactories.updaterNudge())
vi.mock('./update-install-exit-watchdog', () => moduleFactories.updateInstallExitWatchdog())
vi.mock('./updater-prerelease-feed', () => moduleFactories.updaterPrereleaseFeed())
vi.mock('./local-builds/local-build-switch', () => moduleFactories.localBuildSwitch())
vi.mock('./local-builds/local-build-feed-server', () => moduleFactories.localBuildFeedServer())

const homeUpdaterMock = vi.hoisted(() => ({ check: vi.fn(), download: vi.fn(), restart: vi.fn() }))
vi.mock('./home-appimage-runtime', () => ({
  createHomeAppImageUpdater: vi.fn(() => homeUpdaterMock),
  relaunchHomeAppImage: vi.fn()
}))

warmUpdaterModule()
let managedHome: string | undefined

describe('updater', () => {
  beforeEach(() => {
    resetUpdaterMocks()
    vi.stubEnv('ORCA_HOME_INSTALL_MANAGED', undefined)
    vi.stubEnv('APPIMAGE', undefined)
    homeUpdaterMock.check.mockReset()
    homeUpdaterMock.download.mockReset()
    homeUpdaterMock.restart.mockReset()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    if (managedHome) {
      rmSync(managedHome, { recursive: true, force: true })
      managedHome = undefined
    }
  })

  it('does not load or configure electron-updater during dev setup', async () => {
    appMock.isPackaged = false
    const mainWindow = { webContents: { send: vi.fn() } }

    const { setupAutoUpdater } = await loadUpdaterModule()

    setupAutoUpdater(mainWindow as never)

    expect(autoUpdaterMock.updateConfigPath).toBeUndefined()
    expect(autoUpdaterMock.setFeedURL).not.toHaveBeenCalled()
    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()
    expect(powerMonitorOnMock).not.toHaveBeenCalled()
  })

  it('routes managed home actions through the shared pin-preserving updater', async () => {
    vi.stubEnv('ORCA_HOME_INSTALL_MANAGED', '1')
    managedHome = mkdtempSync(path.join(tmpdir(), 'orca-updater-home-'))
    vi.stubEnv('HOME', managedHome)
    vi.stubEnv('USERPROFILE', managedHome)
    vi.stubEnv('APPIMAGE', path.join(managedHome, '.local', 'opt', 'orca', 'orca-linux.AppImage'))
    vi.stubGlobal('process', { ...process, platform: 'linux', arch: 'x64' })
    appMock.getPath.mockReturnValue(managedHome)
    const mainWindow = { webContents: { send: vi.fn() } }
    const updater = await loadUpdaterModule()

    updater.setupAutoUpdater(mainWindow as never)
    await vi.waitFor(() => expect(homeUpdaterMock.check).toHaveBeenCalled())
    expect(updater.getRemoteServerUpdateSupport()).toMatchObject({
      automatic: true,
      reason: 'available'
    })
    updater.checkForUpdates()
    updater.checkForUpdatesFromMenu()
    expect(homeUpdaterMock.check).toHaveBeenCalledWith(true)
    updater.checkForUpdatesFromMenu({ localBuild: true })
    updater.downloadUpdate()
    updater.quitAndInstall()

    expect(autoUpdaterMock.on).not.toHaveBeenCalled()
    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()
    expect(autoUpdaterMock.downloadUpdate).not.toHaveBeenCalled()
    expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled()
    expect(homeUpdaterMock.download).toHaveBeenCalledOnce()
    expect(homeUpdaterMock.restart).toHaveBeenCalledOnce()
    expect(powerMonitorOnMock).not.toHaveBeenCalled()
    expect(fetchNudgeMock).not.toHaveBeenCalled()
    expect(updater.getUpdateStatus()).toMatchObject({ state: 'error', retryable: false })
    expect(updater.getUpdateStatus()).not.toHaveProperty('recovery')

    for (const installMode of [
      'supervised-headless-serve',
      'unsupported-headless-serve'
    ] as const) {
      updater.setupAutoUpdater(null, { installMode })
      expect(updater.getRemoteServerUpdateSupport()).toMatchObject({
        automatic: false,
        reason: 'manual-service-update-required'
      })
    }
  })

  it('recovers the home updater after a cached desktop launch loses launcher environment', async () => {
    managedHome = mkdtempSync(path.join(tmpdir(), 'orca-updater-home-'))
    const image = path.join(managedHome, '.local', 'opt', 'orca', 'orca-linux.AppImage')
    const namespace = path.join(
      managedHome,
      '.cache',
      'orca',
      'appimage',
      appImageNamespaceKey(image)
    )
    mkdirSync(namespace, { recursive: true })
    writeFileSync(path.join(namespace, 'source-appimage'), image)
    vi.stubGlobal('process', {
      ...process,
      platform: 'linux',
      arch: 'x64',
      execPath: path.join(namespace, 'a'.repeat(24), 'orca-ide')
    })
    appMock.getPath.mockReturnValue(managedHome)
    appMock.getVersion.mockReturnValue('1.4.229-10')
    const updater = await loadUpdaterModule()
    updater.setupAutoUpdater(null)

    await vi.waitFor(() => expect(homeUpdaterMock.check).toHaveBeenCalled())
    updater.checkForUpdatesFromMenu()
    expect(homeUpdaterMock.check).toHaveBeenCalledWith(true)
    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()
    expect(autoUpdaterMock.on).not.toHaveBeenCalled()
  })

  it('runs a startup check immediately when the last background check is stale', async () => {
    const mainWindow = { webContents: { send: vi.fn() } }
    const setLastUpdateCheckAt = vi.fn()

    const { setupAutoUpdater } = await loadUpdaterModule()

    setupAutoUpdater(mainWindow as never, {
      getLastUpdateCheckAt: () => Date.now() - 25 * 60 * 60 * 1000,
      setLastUpdateCheckAt
    })

    await vi.waitFor(() => {
      expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1)
    })
    expect(setLastUpdateCheckAt).not.toHaveBeenCalled()
  })

  it('starts nudge polling only after updater initialization is complete', async () => {
    const mainWindow = { webContents: { send: vi.fn() } }
    fetchNudgeMock.mockResolvedValue({ id: 'campaign-1', minVersion: '1.0.0' })
    shouldApplyNudgeMock.mockReturnValue(true)

    const { setupAutoUpdater } = await loadUpdaterModule()

    setupAutoUpdater(mainWindow as never)

    expect(autoUpdaterMock.setFeedURL).toHaveBeenCalledTimes(1)
    expect(autoUpdaterMock.on).toHaveBeenCalled()
    expect(fetchNudgeMock).toHaveBeenCalledTimes(1)
    expect(autoUpdaterMock.setFeedURL.mock.invocationCallOrder[0]).toBeLessThan(
      fetchNudgeMock.mock.invocationCallOrder[0]
    )
    expect(autoUpdaterMock.on.mock.invocationCallOrder[0]).toBeLessThan(
      fetchNudgeMock.mock.invocationCallOrder[0]
    )
  })

  it('waits until the remaining interval before the next background check', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-03T12:00:00Z'))

    const mainWindow = { webContents: { send: vi.fn() } }
    const setLastUpdateCheckAt = vi.fn()

    const { setupAutoUpdater } = await loadUpdaterModule()

    setupAutoUpdater(mainWindow as never, {
      getLastUpdateCheckAt: () => Date.now() - 23 * 60 * 60 * 1000,
      setLastUpdateCheckAt
    })

    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(59 * 60 * 1000)
    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(60 * 1000)
    await vi.waitFor(() => {
      expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1)
    })
    expect(setLastUpdateCheckAt).not.toHaveBeenCalled()
  })

  it('deduplicates rapid focus-triggered daily checks before checking status arrives', async () => {
    let lastUpdateCheckAt = Date.now()
    const mainWindow = { webContents: { send: vi.fn() } }

    autoUpdaterMock.checkForUpdates.mockImplementation(() => new Promise(() => {}))

    const { setupAutoUpdater } = await loadUpdaterModule()

    setupAutoUpdater(mainWindow as never, {
      getLastUpdateCheckAt: () => lastUpdateCheckAt
    })

    lastUpdateCheckAt = Date.now() - 25 * 60 * 60 * 1000
    appMock.emit('browser-window-focus')
    appMock.emit('browser-window-focus')

    await vi.waitFor(() => {
      expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1)
    })
  })

  it('does not persist lastUpdateCheckAt when a focus-triggered check fails benignly', async () => {
    let lastUpdateCheckAt = Date.now()
    const setLastUpdateCheckAt = vi.fn()
    const sendMock = vi.fn()
    const mainWindow = { webContents: { send: sendMock } }

    autoUpdaterMock.checkForUpdates.mockImplementation(() => {
      autoUpdaterMock.emit('checking-for-update')
      queueMicrotask(() => {
        autoUpdaterMock.emit('error', new Error('net::ERR_FAILED'))
      })
      return Promise.reject(new Error('net::ERR_FAILED'))
    })

    const { setupAutoUpdater } = await loadUpdaterModule()

    setupAutoUpdater(mainWindow as never, {
      getLastUpdateCheckAt: () => lastUpdateCheckAt,
      setLastUpdateCheckAt
    })

    lastUpdateCheckAt = Date.now() - 25 * 60 * 60 * 1000
    appMock.emit('browser-window-focus')

    await vi.waitFor(() => {
      const statuses = sendMock.mock.calls
        .filter(([channel]) => channel === 'updater:status')
        .map(([, status]) => status)
      expect(statuses).toContainEqual({ state: 'idle' })
    })

    expect(setLastUpdateCheckAt).not.toHaveBeenCalled()
  })

  it('retries background checks sooner after a failed automatic check', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-03T12:00:00Z'))

    autoUpdaterMock.checkForUpdates.mockImplementation(() => {
      autoUpdaterMock.emit('checking-for-update')
      queueMicrotask(() => {
        autoUpdaterMock.emit('error', new Error('boom'))
      })
      return Promise.reject(new Error('boom'))
    })

    const sendMock = vi.fn()
    const mainWindow = { webContents: { send: sendMock } }

    const { setupAutoUpdater } = await loadUpdaterModule()

    setupAutoUpdater(mainWindow as never, {
      getLastUpdateCheckAt: () => null,
      setLastUpdateCheckAt: vi.fn()
    })

    await vi.waitFor(() => {
      expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1)
    })

    await vi.advanceTimersByTimeAsync(59 * 60 * 1000)
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(60 * 1000)
    await vi.waitFor(() => {
      expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(2)
    })
  })

  it('reschedules the next automatic check 24 hours after finding an available update', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-03T12:00:00Z'))

    autoUpdaterMock.checkForUpdates.mockImplementation(() => {
      autoUpdaterMock.emit('checking-for-update')
      queueMicrotask(() => {
        autoUpdaterMock.emit('update-available', { version: '1.0.61' })
      })
      return Promise.resolve(undefined)
    })

    const sendMock = vi.fn()
    const setLastUpdateCheckAt = vi.fn()
    const mainWindow = { webContents: { send: sendMock } }

    const { setupAutoUpdater } = await loadUpdaterModule()

    // Start 23h in to distinguish the result handler's re-arm from the initial startup timer.
    setupAutoUpdater(mainWindow as never, {
      getLastUpdateCheckAt: () => Date.now() - 23 * 60 * 60 * 1000,
      setLastUpdateCheckAt
    })

    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
    await vi.waitFor(() => {
      expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1)
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(setLastUpdateCheckAt).toHaveBeenCalledTimes(1)
    expect(sendMock).toHaveBeenCalledWith('updater:status', {
      state: 'available',
      version: '1.0.61',
      changelog: null
    })

    await vi.advanceTimersByTimeAsync(23 * 60 * 60 * 1000)
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
    // Other timers fire at this boundary too; assert the schedule rather than an exact global call count.
    await vi.waitFor(() => {
      expect(autoUpdaterMock.checkForUpdates.mock.calls.length).toBeGreaterThanOrEqual(2)
    })
  })

  it('does not disable Windows Authenticode verification on win32', async () => {
    vi.stubGlobal('process', { ...process, platform: 'win32' })

    const { setupAutoUpdater } = await loadUpdaterModule()

    const sendMock = vi.fn()
    const mainWindow = { webContents: { send: sendMock } }

    setupAutoUpdater(mainWindow as never)

    expect((autoUpdaterMock as Record<string, unknown>).verifyUpdateCodeSignature).toBeUndefined()
  })
})
