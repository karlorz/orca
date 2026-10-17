import { app } from 'electron'
import path from 'node:path'
import { runProcess } from '@orca/process-host'
import { getDaemonProvider } from './daemon/daemon-provider-state'
import { getAllDaemonAdapters } from './daemon/daemon-provider-routing'
import { fetchHomeUpdateViaElectron } from './home-appimage-electron-fetch'
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

async function liveHomeDaemonProtocols(): Promise<readonly number[] | null> {
  const provider = getDaemonProvider()
  if (!provider) {
    return null
  }
  const adapters = getAllDaemonAdapters(provider)
  try {
    return await Promise.race([
      Promise.all(
        adapters.map(async (adapter) => {
          await adapter.listSessions()
          return adapter.protocolVersion
        })
      ),
      new Promise<null>((resolve) => {
        const timer = setTimeout(() => resolve(null), 5_000)
        timer.unref()
      })
    ])
  } catch {
    return null
  }
}

export function createHomeAppImageUpdater(
  callbacks: Pick<
    HomeAppImageUpdaterOptions,
    'sendStatus' | 'prepareRestart' | 'restart' | 'restartAborted' | 'recordCheck'
  >
): HomeAppImageUpdater {
  const image = process.env.APPIMAGE
  if (!image) {
    throw new Error('Managed home AppImage has no runtime image path')
  }
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

export function relaunchHomeAppImage(): void {
  const image = process.env.APPIMAGE
  if (!image) {
    throw new Error('Managed home AppImage has no restart executable')
  }
  app.relaunch({ execPath: image, args: process.argv.slice(1) })
  app.quit()
}
