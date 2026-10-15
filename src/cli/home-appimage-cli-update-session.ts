import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { runProcess } from '@orca/process-host'
import {
  HOME_APPIMAGE_NAME,
  acquireHomeAppImageLock,
  commitHomeAppImage,
  reconcileHomeAppImage,
  validHomeReleaseTag
} from '../main/orca-home-appimage-install'
import {
  PROTOCOL_VERSION,
  PREVIOUS_DAEMON_PROTOCOL_VERSIONS
} from '../main/daemon/daemon-protocol-version'
import { parseDaemonPidFile } from '../main/daemon/daemon-pid-file-parse'
import { HomeAppImageUpdater } from '../main/home-appimage-updater'
import { isEnsureManagedHomeAppImage } from '../main/linux-home-update-policy'
import { readOrcaCliVersion } from './cli-version'
import type { HomeAppImageCliUpdateSession } from './home-appimage-cli-update'
import { getDefaultUserDataPath } from './runtime/metadata'
import { RuntimeClientError } from './runtime/types'

export type HomeAppImageCliUpdateHost = {
  platform: NodeJS.Platform
  arch: string
  env: NodeJS.ProcessEnv
  homeDir: string
  userDataPath: string
  cliVersion: string | null
  exists: (path: string) => boolean
  fetch: (url: string, init?: RequestInit) => Promise<Response>
  liveProtocols: () => Promise<readonly number[] | null>
}

export function defaultHomeAppImageCliUpdateHost(): HomeAppImageCliUpdateHost {
  return {
    platform: process.platform,
    arch: process.arch,
    env: process.env,
    homeDir: homedir(),
    userDataPath: getDefaultUserDataPath(),
    cliVersion: readOrcaCliVersion(),
    exists: (path) => existsSync(path),
    fetch: (url, init) => globalThis.fetch(url, init),
    liveProtocols: () => probeLiveHomeDaemonProtocols(getDefaultUserDataPath())
  }
}

export async function createProductionHomeAppImageCliUpdateSession(
  host: HomeAppImageCliUpdateHost = defaultHomeAppImageCliUpdateHost()
): Promise<HomeAppImageCliUpdateSession> {
  if (process.env.VITEST) {
    throw new RuntimeClientError(
      'update_unavailable',
      'Home AppImage CLI update tests must inject a session.'
    )
  }
  if (host.platform !== 'linux') {
    throw new RuntimeClientError(
      'unsupported_platform',
      'orca update check|apply updates the Linux home AppImage install.'
    )
  }
  const root = resolveHomeAppImageRoot(host)
  const runningTag = await resolveRunningHomeTag(root, host.cliVersion)
  let installedTag = runningTag
  return {
    runningTag,
    readInstalledTag: async () => installedTag,
    createUpdater: (sendStatus) =>
      new HomeAppImageUpdater({
        root,
        runningTag,
        fetch: host.fetch,
        liveProtocols: host.liveProtocols,
        lock: () => acquireHomeAppImageLock(root),
        reconcile: async () => {
          const identity = await reconcileHomeAppImage(root, runningTag, extractHomeAppImage)
          installedTag = identity.tag
          return identity
        },
        commit: async (stage, tag) => {
          await commitHomeAppImage(root, stage, tag, extractHomeAppImage)
          installedTag = tag
        },
        sendStatus,
        restart: async () => undefined,
        restartAborted: () => undefined,
        recordCheck: () => undefined
      })
  }
}

export function resolveHomeAppImageRoot(host: HomeAppImageCliUpdateHost): string {
  const image = host.env.APPIMAGE
  if (
    typeof image === 'string' &&
    isEnsureManagedHomeAppImage({
      platform: host.platform,
      architecture: host.arch,
      packageType: 'non-root',
      managed: host.env.ORCA_HOME_INSTALL_MANAGED ?? '1',
      appImagePath: image,
      homeDirectory: host.homeDir
    })
  ) {
    return dirname(image)
  }
  const fallback = join(host.homeDir, '.local', 'opt', 'orca')
  if (host.exists(join(fallback, HOME_APPIMAGE_NAME))) {
    return fallback
  }
  throw new RuntimeClientError(
    'update_unavailable',
    'orca update check|apply requires the Linux home AppImage install (~/.local/opt/orca).'
  )
}

export async function probeLiveHomeDaemonProtocols(
  userDataPath: string
): Promise<readonly number[] | null> {
  const runtimeDir = join(userDataPath, 'daemon')
  const live: number[] = []
  for (const protocolVersion of [PROTOCOL_VERSION, ...PREVIOUS_DAEMON_PROTOCOL_VERSIONS]) {
    if (await daemonProtocolMayBeLive(runtimeDir, protocolVersion)) {
      live.push(protocolVersion)
    }
  }
  return live.length > 0 ? live : null
}

async function resolveRunningHomeTag(root: string, cliVersion: string | null): Promise<string> {
  const fromCli = cliVersion ? `v${cliVersion}` : null
  if (fromCli && validHomeReleaseTag(fromCli)) {
    return fromCli
  }
  try {
    const pin = (await readFile(join(root, 'release-tag'), 'utf8')).trim()
    if (validHomeReleaseTag(pin)) {
      return pin
    }
  } catch {
    // The pin file is optional; a missing or invalid tag fails closed below.
  }
  throw new RuntimeClientError(
    'update_unavailable',
    'Could not determine the running home AppImage tag.'
  )
}

async function daemonProtocolMayBeLive(
  runtimeDir: string,
  protocolVersion: number
): Promise<boolean> {
  try {
    const parsed = parseDaemonPidFile(
      await readFile(join(runtimeDir, `daemon-v${protocolVersion}.pid`), 'utf8')
    )
    if (!parsed) {
      return false
    }
    process.kill(parsed.pid, 0)
    return true
  } catch {
    return false
  }
}

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
