import { app, powerMonitor } from 'electron'
import type { BrowserWindow } from 'electron'
import { resolveAppImageGenerationOfExecutable } from '../../shared/appimage-cache-identity'
import type { ReleaseBuild, ReleaseChannel } from '../../shared/release-channel'
import type { ReleaseBuildListOptions } from '../updater-release-build-cache'
import type {
  LinuxPackageInstallInstructions,
  UpdateCheckOptions,
  UpdateStatus
} from '../../shared/update-status-types'
import type {
  RemoteServerUpdateInstallResult,
  RemoteServerUpdaterSnapshot,
  RemoteServerUpdateSupport
} from '../../shared/remote-server-update'
import { getLinuxPackageType } from '../linux-update-package-type'
import { resolveEnsureManagedHomeAppImage } from '../linux-home-update-policy'
import { createUpdaterDiagnosticLogger } from '../linux-package-install-diagnostic'
import { registerAutoUpdaterHandlers } from '../updater-events'
import { KARLORZ_FORK_RELEASE_FEED, selectReleaseFeed } from '../updater-prerelease-feed'
import { getServeUpdateHandoffFailure } from '../serve-update-handoff'
import { recordUpdaterLifecycle } from '../updater-lifecycle-diagnostics'
import { AUTO_UPDATE_CHECK_INTERVAL_MS } from './updater-state'
import { UpdaterDownloadInstall } from './updater-download-install'
import { configureMacShipItScheduling } from './macos-shipit-scheduling'
import type { PreQuitCleanupFailureMode, UpdateInstallMode } from './updater-state'

export type UpdaterSetupOptions = {
  getLastUpdateCheckAt?: () => number | null
  onBeforeQuit?: () => void | Promise<void>
  setLastUpdateCheckAt?: (timestamp: number) => void
  getPendingUpdateNudgeId?: () => string | null
  getDismissedUpdateNudgeId?: () => string | null
  setPendingUpdateNudgeId?: (id: string | null) => void
  setDismissedUpdateNudgeId?: (id: string | null) => void
  getReleaseChannelOverride?: () => ReleaseChannel | null
  installMode?: UpdateInstallMode
  onBeforeQuitFailure?: PreQuitCleanupFailureMode
}

export class UpdaterSetup extends UpdaterDownloadInstall {
  checkForUpdates(): void {
    this.checkForUpdatesInBackground()
  }

  checkForUpdatesFromMenu(options?: UpdateCheckOptions): void {
    super.checkForUpdatesFromMenu(options)
  }

  downloadUpdate(): void {
    super.downloadUpdate()
  }

  quitAndInstall(): void {
    super.quitAndInstall()
  }

  isQuittingForUpdate(): boolean {
    return super.isQuittingForUpdate()
  }

  getUpdateStatus(): UpdateStatus {
    return super.getUpdateStatus()
  }

  getRemoteServerUpdateSupport(): RemoteServerUpdateSupport {
    return super.getRemoteServerUpdateSupport()
  }

  getRemoteServerUpdaterSnapshot(runtimeId: string): RemoteServerUpdaterSnapshot {
    return super.getRemoteServerUpdaterSnapshot(runtimeId)
  }

  checkForRemoteServerUpdate(
    runtimeId: string,
    options?: UpdateCheckOptions
  ): RemoteServerUpdaterSnapshot {
    return super.checkForRemoteServerUpdate(runtimeId, options)
  }

  downloadRemoteServerUpdate(runtimeId: string): RemoteServerUpdaterSnapshot {
    return super.downloadRemoteServerUpdate(runtimeId)
  }

  installRemoteServerUpdate(runtimeId: string): RemoteServerUpdateInstallResult {
    return super.installRemoteServerUpdate(runtimeId)
  }

  resolveUpdateInstallMode(isServeMode: boolean): UpdateInstallMode {
    return super.resolveUpdateInstallMode(isServeMode)
  }

  async getLinuxPackageInstallInstructions(): Promise<LinuxPackageInstallInstructions> {
    return super.getLinuxPackageInstallInstructions()
  }

  async showLinuxPackage(): Promise<void> {
    return super.showLinuxPackage()
  }

  async listAvailableReleaseBuilds(
    channel: ReleaseChannel,
    options?: ReleaseBuildListOptions
  ): Promise<ReleaseBuild[]> {
    return super.listAvailableReleaseBuilds(channel, options)
  }

  dismissNudge(): void {
    super.dismissNudge()
  }

  dismissAvailableUpdate(): void {
    super.dismissAvailableUpdate()
  }

  setupAutoUpdater(mainWindow: BrowserWindow | null, opts?: UpdaterSetupOptions): void {
    // Headless setup must not erase a later attached window.
    this.mainWindowRef = mainWindow ?? this.mainWindowRef
    this.onBeforeQuitCleanup = opts?.onBeforeQuit ?? null
    this.onBeforeQuitFailure = opts?.onBeforeQuitFailure ?? 'continue'
    this.persistLastUpdateCheckAt = opts?.setLastUpdateCheckAt ?? null
    this._getLastUpdateCheckAt = opts?.getLastUpdateCheckAt ?? null
    this._getPendingUpdateNudgeId = opts?.getPendingUpdateNudgeId ?? null
    this._getDismissedUpdateNudgeId = opts?.getDismissedUpdateNudgeId ?? null
    this._setPendingUpdateNudgeId = opts?.setPendingUpdateNudgeId ?? null
    this._setDismissedUpdateNudgeId = opts?.setDismissedUpdateNudgeId ?? null
    this.getReleaseChannelOverride = opts?.getReleaseChannelOverride ?? null
    this.updateInstallMode = opts?.installMode ?? 'interactive'
    this.lastInstallDeferralVersion = { download: null, install: null }

    const serveHandoffFailure = getServeUpdateHandoffFailure()
    if (serveHandoffFailure) {
      recordUpdaterLifecycle(
        'headless_serve_handoff_failed',
        { reason: serveHandoffFailure },
        { level: 'warn', message: 'Supervised serve update did not complete' }
      )
      this.sendErrorStatus(`The server update did not complete: ${serveHandoffFailure}`, true)
    }

    if (!app.isPackaged) {
      return
    }

    const homeImage =
      process.platform === 'linux' &&
      (process.env.ORCA_HOME_INSTALL_MANAGED === '1' ||
        resolveAppImageGenerationOfExecutable(process.execPath))
        ? resolveEnsureManagedHomeAppImage({
            platform: process.platform,
            architecture: process.arch,
            packageType: getLinuxPackageType(),
            managed: process.env.ORCA_HOME_INSTALL_MANAGED,
            appImagePath: process.env.APPIMAGE,
            homeDirectory: app.getPath('home'),
            execPath: process.execPath
          })
        : null
    this.homeInstallManaged = homeImage !== null
    if (homeImage) {
      if (this.homeAppImageUpdater) {
        return
      }
      void import('../home-appimage-runtime')
        .then(({ createHomeAppImageUpdater, relaunchHomeAppImage }) => {
          this.homeAppImageUpdater = createHomeAppImageUpdater(homeImage, {
            sendStatus: (status) => this.sendStatus(status),
            recordCheck: () => this.recordCompletedUpdateCheck(),
            restartAborted: () => {
              this.quittingForUpdate = false
              this.mainWindowRef?.webContents.send('updater:quitAndInstallAborted')
            },
            prepareRestart: async () => {
              this.quittingForUpdate = true
              await this.runBeforeUpdateQuitCleanup()
            },
            restart: async () => relaunchHomeAppImage(homeImage)
          })
          void this.homeAppImageUpdater.check()
          this.scheduleAutomaticUpdateCheck(AUTO_UPDATE_CHECK_INTERVAL_MS)
        })
        .catch((error) => this.sendErrorStatus(String(error), true))
      return
    }

    const autoUpdater = this.getAutoUpdater()
    configureMacShipItScheduling()
    autoUpdater.autoDownload = false
    if (this.activeUpdateSource === 'release') {
      autoUpdater.allowDowngrade = false
      autoUpdater.disableDifferentialDownload = false
    }
    // Implicit quit install requires interactive mode and an explicit non-root/AppImage marker; serve requires handoff.
    autoUpdater.autoInstallOnAppQuit =
      this.updateInstallMode === 'interactive' && getLinuxPackageType() === 'non-root'
    // MacUpdater ignores quitAndInstall arguments; only the surviving CLI supervisor may relaunch serve.
    autoUpdater.autoRunAppAfterInstall = this.updateInstallMode === 'interactive'
    // Keep native updater diagnostics visible through local logging.
    autoUpdater.logger = createUpdaterDiagnosticLogger() as never

    // Security: never re-add a verifyUpdateCodeSignature override — a no-op disables electron-updater's built-in Authenticode check and accepts any installer.
    if (this.activeUpdateSource === 'release') {
      // Fork builds pin their own feed at check time; the stablyai latest/download URL must not overwrite it.
      if (selectReleaseFeed(app.getVersion()) !== KARLORZ_FORK_RELEASE_FEED) {
        autoUpdater.setFeedURL({
          provider: 'generic',
          url: 'https://github.com/stablyai/orca/releases/latest/download'
        })
      }
    }
    if (this.autoUpdaterInitialized) {
      return
    }
    this.autoUpdaterInitialized = true

    registerAutoUpdaterHandlers({
      autoUpdater,
      clearBackgroundCheckLaunchPending: () => this.clearBackgroundCheckLaunchPending(),
      clearAvailableUpdateContext: () => this.clearAvailableUpdateContext(),
      consumeMissingManifestPrereleaseFallbackResult: () =>
        this.consumeMissingManifestPrereleaseFallbackResult(),
      getPublishingWindowLastGoodCheck: () => this.getPublishingWindowLastGoodCheck(),
      getMissingManifestPrereleaseFallbackUserInitiated: () =>
        this.getMissingManifestPrereleaseFallbackUserInitiated(),
      getCurrentStatus: () => this.currentStatus,
      getActiveUpdateCheckEventAttemptId: () => this.getActiveUpdateCheckEventAttemptId(),
      getKnownReleaseUrl: () => this.getKnownReleaseUrl(),
      getPendingInstallVersion: () => this.getPendingInstallVersion(),
      getUserInitiatedCheck: () => this.userInitiatedCheck,
      handleQuitAndInstallFailure: (error) => this.handleQuitAndInstallFailure(error),
      isQuitAndInstallHandoffActive: () => this.isQuitAndInstallHandoffActive(),
      hasInstallableDownloadedVersion: () => this.hasInstallableDownloadedVersion(),
      isLocalBuildCheck: () => this.activeUpdateSource === 'local',
      // Explicit pinned jumps may target versions older than the running build.
      isPinnedBuildCheck: () => this.isPinnedBuildActive,
      shouldHandleUpdaterErrorEvent: () => this.shouldHandleUpdaterErrorEvent(),
      clearUpdateAvailableEventPending: (attemptId) =>
        this.clearUpdateAvailableEventPending(attemptId),
      isActiveUpdateCheckAttempt: (attemptId) => this.isActiveUpdateCheckAttempt(attemptId),
      markUpdateCheckEventAttempt: () => this.markUpdateCheckEventAttempt(),
      markUpdateAvailableEventPending: (attemptId) =>
        this.markUpdateAvailableEventPending(attemptId),
      markMissingManifestPrereleaseFallbackChecking: () =>
        this.markMissingManifestPrereleaseFallbackChecking(),
      performQuitAndInstall: () => this.performQuitAndInstall(),
      commitStagedMacInstall: () => this.commitStagedMacInstall(),
      failMacStaging: (error) => this.failMacStaging(error),
      isAwaitingMacStaging: () => this.isAwaitingMacStaging(),
      isMacStagingDeferredToInstall: () => this.isMacStagingDeferredToInstall(),
      shouldDeferMacQuitForInstall: () => this.updateInstallMode === 'interactive',
      recordCompletedUpdateCheck: () => this.recordCompletedUpdateCheck(),
      restoreReleaseUpdateSource: () => this.restoreReleaseUpdateSource(),
      sendCheckFailureStatus: (message, userInitiated, source, sourceError) =>
        this.sendCheckFailureStatus(message, userInitiated, source, sourceError),
      sendErrorStatus: (message, userInitiated) => this.sendErrorStatus(message, userInitiated),
      sendStatus: (status) => this.sendStatus(status),
      scheduleAutomaticUpdateCheck: (delayMs) => this.scheduleAutomaticUpdateCheck(delayMs),
      shouldSuppressMissingManifestPrereleaseFallbackEvent: (message, error) =>
        this.shouldSuppressMissingManifestPrereleaseFallbackEvent(message, error),
      suppressMissingManifestPrereleaseFallbackPromiseFailure: (message) =>
        this.suppressMissingManifestPrereleaseFallbackPromiseFailure(message),
      setAvailableReleaseUrl: (releaseUrl) => {
        this.availableReleaseUrl = releaseUrl
      },
      setAvailableVersion: (version) => {
        this.availableVersion = version
      },
      setUserInitiatedCheck: (value) => {
        this.userInitiatedCheck = value
      }
    })

    void this.checkForUpdateNudge()
    this.scheduleUpdateNudgeCheck()

    const checkDailyOnWake = () => {
      void this.checkForUpdateNudge()
      if (
        this.backgroundCheckLaunchPending ||
        this.currentStatus.state === 'checking' ||
        this.currentStatus.state === 'downloading'
      ) {
        return
      }
      const lastCheck = this._getLastUpdateCheckAt?.() ?? null
      const msSince = lastCheck === null ? Number.POSITIVE_INFINITY : Date.now() - lastCheck
      if (msSince >= AUTO_UPDATE_CHECK_INTERVAL_MS) {
        this.runBackgroundUpdateCheck()
        this.scheduleAutomaticUpdateCheck(AUTO_UPDATE_CHECK_INTERVAL_MS)
      }
    }
    powerMonitor.on('resume', checkDailyOnWake)
    app.on('browser-window-focus', checkDailyOnWake)

    const lastUpdateCheckAt = opts?.getLastUpdateCheckAt?.() ?? null
    const msSinceLastCheck =
      lastUpdateCheckAt === null ? Number.POSITIVE_INFINITY : Date.now() - lastUpdateCheckAt
    if (msSinceLastCheck >= AUTO_UPDATE_CHECK_INTERVAL_MS) {
      this.runBackgroundUpdateCheck()
      this.scheduleAutomaticUpdateCheck(AUTO_UPDATE_CHECK_INTERVAL_MS)
    } else {
      this.scheduleAutomaticUpdateCheck(AUTO_UPDATE_CHECK_INTERVAL_MS - msSinceLastCheck)
    }
  }
}
