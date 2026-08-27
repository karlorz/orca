import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appMock, autoUpdaterMock, moduleFactories, resetUpdaterMocks } = await vi.hoisted(
  async () => (await import('./updater-test-harness')).createUpdaterMocks()
)

const fetchNewerForkDesktopReleaseTagMock = vi.fn()

vi.mock('electron', () => moduleFactories.electron())
vi.mock('electron-updater', () => moduleFactories.electronUpdater())
vi.mock('./electron-updater-loader', () => moduleFactories.electronUpdaterLoader())
vi.mock('@electron-toolkit/utils', () => moduleFactories.electronToolkitUtils())
vi.mock('./ipc/pty', () => moduleFactories.ipcPty())
vi.mock('./linux-update-package-type', () => moduleFactories.linuxUpdatePackageType())
vi.mock('./updater-lifecycle-diagnostics', () => moduleFactories.updaterLifecycleDiagnostics())
vi.mock('./updater-changelog', () => moduleFactories.updaterChangelog())
vi.mock('./updater-nudge', () => moduleFactories.updaterNudge())
vi.mock('./update-install-exit-watchdog', () => moduleFactories.updateInstallExitWatchdog())
vi.mock('./updater-prerelease-feed', () => {
  const KARLORZ_FORK_RELEASE_FEED = {
    repoAtomUrl: 'https://github.com/karlorz/orca/releases.atom',
    releaseDownloadBase: 'https://github.com/karlorz/orca/releases/download',
    tagHrefPattern: /href="https:\/\/github\.com\/karlorz\/orca\/releases\/tag\/([^"]+)"/,
    desktopTagPattern: /^v\d+\.\d+\.\d+-\d+$/
  }
  const STABLYAI_RELEASE_FEED = {
    repoAtomUrl: 'https://github.com/stablyai/orca/releases.atom',
    releaseDownloadBase: 'https://github.com/stablyai/orca/releases/download',
    tagHrefPattern: /href="https:\/\/github\.com\/stablyai\/orca\/releases\/tag\/([^"]+)"/,
    desktopTagPattern: /^v?\d+\.\d+\.\d+(?:-rc\.\d+(?:\.perf)?)?$/
  }
  return {
    KARLORZ_FORK_RELEASE_FEED,
    STABLYAI_RELEASE_FEED,
    selectReleaseFeed: (currentVersion: string) => {
      const isFork =
        currentVersion.includes('fork.voice') || /^v?\d+\.\d+\.\d+-\d+$/.test(currentVersion)
      return isFork ? KARLORZ_FORK_RELEASE_FEED : STABLYAI_RELEASE_FEED
    },
    fetchNewerForkDesktopReleaseTag: fetchNewerForkDesktopReleaseTagMock,
    fetchNewerReleaseTagsWithReadiness: vi.fn(),
    getReleaseDownloadUrl: (tag: string) =>
      `https://github.com/stablyai/orca/releases/download/${tag}`,
    getReleaseDownloadUrlForFeed: (feed: { releaseDownloadBase: string }, tag: string) =>
      `${feed.releaseDownloadBase}/${tag}`
  }
})
vi.mock('./local-builds/local-build-switch', () => moduleFactories.localBuildSwitch())
vi.mock('./local-builds/local-build-feed-server', () => moduleFactories.localBuildFeedServer())

describe('updater fork feed selection', () => {
  beforeEach(() => {
    resetUpdaterMocks()
    fetchNewerForkDesktopReleaseTagMock.mockReset()
  })

  it('pins a karlorz release URL when a newer fork tag is resolved', async () => {
    appMock.getVersion.mockReturnValue('1.4.190-4')
    fetchNewerForkDesktopReleaseTagMock.mockResolvedValue('v1.4.190-5')
    autoUpdaterMock.checkForUpdates.mockResolvedValue(undefined)

    const { setupAutoUpdater, checkForUpdatesFromMenu } = await import('./updater')

    const mainWindow = { webContents: { send: vi.fn() } }
    setupAutoUpdater(mainWindow as never, { getLastUpdateCheckAt: () => Date.now() })

    // Setup does NOT pin releases/latest/download for canonical fork build
    expect(autoUpdaterMock.setFeedURL).not.toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://github.com/stablyai/orca/releases/latest/download'
      })
    )

    checkForUpdatesFromMenu()

    await vi.waitFor(() => {
      expect(fetchNewerForkDesktopReleaseTagMock).toHaveBeenCalled()
      expect(autoUpdaterMock.setFeedURL).toHaveBeenLastCalledWith({
        provider: 'generic',
        url: 'https://github.com/karlorz/orca/releases/download/v1.4.190-5'
      })
      expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1)
    })
  })

  it('does not pin releases/latest/download when fork resolver returns null', async () => {
    appMock.getVersion.mockReturnValue('1.4.190-4')
    fetchNewerForkDesktopReleaseTagMock.mockResolvedValue(null)
    autoUpdaterMock.checkForUpdates.mockResolvedValue(undefined)

    const { setupAutoUpdater, checkForUpdatesFromMenu } = await import('./updater')

    const mainWindow = { webContents: { send: vi.fn() } }
    setupAutoUpdater(mainWindow as never, { getLastUpdateCheckAt: () => Date.now() })

    checkForUpdatesFromMenu()

    await vi.waitFor(() => {
      expect(fetchNewerForkDesktopReleaseTagMock).toHaveBeenCalled()
      expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1)
    })

    // setFeedURL must never be called with stablyai latest or any stablyai url
    for (const call of autoUpdaterMock.setFeedURL.mock.calls) {
      const feedArg = call[0] as { url?: string }
      expect(feedArg?.url).not.toContain('stablyai/orca')
      expect(feedArg?.url).not.toContain('releases/latest/download')
    }
  })
})
