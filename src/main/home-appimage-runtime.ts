import { app } from 'electron'
import path from 'node:path'
import { runProcess } from '@orca/process-host'
import { getDaemonProvider } from './daemon/daemon-provider-state'
import { getAllDaemonAdapters } from './daemon/daemon-provider-routing'
import { probeHomeDaemonAdapters } from './home-appimage-daemon-probe'
import { fetchHomeUpdateViaElectron } from './home-appimage-electron-fetch'
import type { HomeLiveDaemonState } from './home-appimage-release-policy'
import { HomeAppImageUpdater, type HomeAppImageUpdaterOptions } from './home-appimage-updater'
import {
  acquireHomeAppImageLock,
  commitHomeAppImage,
  reconcileHomeAppImage
} from './orca-home-appimage-install'

async function extractHomeAppImage(image: string, cwd: string): Promise<void> {
  for (const resource of [
    'resources/package-type',
    'resources/orcad-template/orcad-template.json'
  ]) {
    const result = await runProcess({
      program: image,
      args: ['--appimage-extract', resource],
      cwd,
      timeoutMs: 60_000,
      maxOutputBytes: 64 * 1024
    })
    if (result.code !== 0 || result.timedOut) {
      throw new Error('Could not verify the AppImage package marker and deployment template')
    }
  }
}

export async function liveHomeDaemonProtocols(): Promise<HomeLiveDaemonState> {
  const provider = getDaemonProvider()
  if (!provider) {
    return { protocols: null, reason: 'unavailable', detail: 'daemon provider not started' }
  }
  let state: HomeLiveDaemonState
  try {
    state = await probeHomeDaemonAdapters(getAllDaemonAdapters(provider))
  } catch {
    state = { protocols: null, reason: 'adapter-error' }
  }
  if (state.protocols === null) {
    console.warn(
      `[updater] home AppImage daemon probe unknown: ${state.reason}${state.detail ? ` (${state.detail})` : ''}`
    )
  } else if (state.skipped?.length) {
    console.info(
      `[updater] home AppImage daemon probe skipped refused generations: ${state.skipped.join(', ')}`
    )
  }
  return state
}

export function createHomeAppImageUpdater(
  image: string,
  callbacks: Pick<
    HomeAppImageUpdaterOptions,
    'sendStatus' | 'prepareRestart' | 'restart' | 'restartAborted' | 'recordCheck'
  >
): HomeAppImageUpdater {
  const root = path.dirname(image)
  const runningTag = `v${app.getVersion()}`
  return new HomeAppImageUpdater({
    ...callbacks,
    root,
    runningTag,
    fetch: fetchHomeUpdateViaElectron,
    liveProtocols: liveHomeDaemonProtocols,
    lock: () => acquireHomeAppImageLock(root),
    reconcile: () => reconcileHomeAppImage(root, runningTag, extractHomeAppImage),
    commit: async (stage, tag) => {
      await commitHomeAppImage(root, stage, tag, extractHomeAppImage)
    }
  })
}

export function relaunchHomeAppImage(image: string): void {
  // A cached launch has no FUSE runtime environment to carry into the replacement image.
  if (!process.env.APPIMAGE) {
    process.env.APPIMAGE_EXTRACT_AND_RUN = '1'
    process.env.ORCA_HOME_INSTALL_MANAGED = '1'
  }
  app.relaunch({ execPath: image, args: process.argv.slice(1) })
  app.quit()
}
