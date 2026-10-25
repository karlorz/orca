import path from 'node:path'
import { app } from 'electron'
import type { CrashReportBreadcrumbData } from '../shared/crash-reporting'
import { recordDurableCrashBreadcrumb } from './crash-reporting/durable-crash-breadcrumb'
import { resolveEnsureManagedHomeAppImage } from './linux-home-update-policy'
import { getLinuxPackageType } from './linux-update-package-type'
import { runWithLaunchPath } from './startup/hydrate-shell-path'
import { getWindowsAdministratorRelaunchOptions } from './windows/windows-administrator-restart'

export type AppRelaunchReason =
  | 'admin-restart'
  | 'gpu-fallback'
  | 'profile-switch'
  | 'profile-transfer'
  | 'renderer-request'
  | 'windows-administrator'

function getHomeAppImageRelaunchOptions(
  options?: Electron.RelaunchOptions
): Electron.RelaunchOptions | undefined {
  if (process.platform !== 'linux' || !app.isPackaged || options?.execPath !== undefined) {
    return options
  }
  const homeDirectory = app.getPath('home')
  const image = resolveEnsureManagedHomeAppImage({
    platform: process.platform,
    architecture: process.arch,
    packageType: getLinuxPackageType(),
    managed: process.env.ORCA_HOME_INSTALL_MANAGED,
    appImagePath: process.env.APPIMAGE,
    homeDirectory,
    execPath: process.execPath
  })
  if (
    !image ||
    image !== path.join(homeDirectory, '.local', 'opt', 'orca', 'orca-linux.AppImage')
  ) {
    return options
  }
  // Cached launches need the same extract-and-run settings as a home update restart.
  if (!process.env.APPIMAGE) {
    process.env.APPIMAGE_EXTRACT_AND_RUN = '1'
    process.env.ORCA_HOME_INSTALL_MANAGED = '1'
  }
  return { ...options, execPath: image, args: options?.args ?? process.argv.slice(1) }
}

export function relaunchApp(
  reason: AppRelaunchReason,
  data?: CrashReportBreadcrumbData,
  options?: Electron.RelaunchOptions
): void {
  // Persist the cause before relaunch can exit this process.
  recordDurableCrashBreadcrumb('app_relaunch_requested', { ...data, reason })
  runWithLaunchPath(() =>
    app.relaunch(
      getHomeAppImageRelaunchOptions(options) ?? getWindowsAdministratorRelaunchOptions()
    )
  )
}

export async function runBeforeRelaunchCleanup(
  onBeforeRelaunch?: () => void | Promise<void>
): Promise<void> {
  try {
    await onBeforeRelaunch?.()
  } catch (error) {
    // Cleanup must not block relaunch; log only error.name to keep secrets out of logs.
    console.warn(
      '[app] Pre-relaunch cleanup failed; continuing relaunch:',
      error instanceof Error ? error.name : typeof error
    )
  }
}
