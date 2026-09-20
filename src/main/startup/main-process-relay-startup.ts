import { app, powerMonitor } from 'electron'
import { getOrcaCloudAuthConfig } from '../orca-profiles/profile-cloud-auth-config'
import { getProfileUserDataPath } from '../orca-profiles/profile-storage-paths'
import type { OrcaRuntimeRpcServer } from '../runtime/runtime-rpc'
import type { MobileRelayPairingProvider } from '../runtime/runtime-rpc/runtime-rpc-pairing-types'
import { DesktopRelayService } from '../runtime/relay/desktop-relay-service'
import { mainProcessState as state } from './main-process-state'
import { publishDesktopRelayStatus } from './main-process-relay-status'

const ATTACH_RETRY_DELAYS_MS = [1_000, 5_000, 15_000, 60_000] as const

let attachRetryTimer: ReturnType<typeof setTimeout> | null = null
let attachRetryIndex = 0
let resumeHandler: (() => void) | null = null

function clearAttachRetry(): void {
  if (attachRetryTimer) {
    clearTimeout(attachRetryTimer)
    attachRetryTimer = null
  }
  attachRetryIndex = 0
}

function tryStartDesktopRelayService(runtimeRpc: OrcaRuntimeRpcServer): DesktopRelayService | null {
  if (state.desktopRelayService || state.isQuitting) {
    return state.desktopRelayService
  }
  if (!runtimeRpc.getE2EEKeypair() || !runtimeRpc.getMobileSocketWiring()) {
    return null
  }
  const cloudAuth = getOrcaCloudAuthConfig()
  if (!cloudAuth.configured) {
    return null
  }
  try {
    const relayService = new DesktopRelayService({
      authConfig: cloudAuth.config,
      userDataPath: getProfileUserDataPath(),
      appVersion: app.getVersion(),
      runtimeRpc,
      onStatus: publishDesktopRelayStatus
    })
    state.desktopRelayService = relayService
    relayService.start()
    clearAttachRetry()
    return relayService
  } catch (error) {
    console.warn(
      '[relay] Desktop relay startup unavailable:',
      error instanceof Error ? error.message : String(error)
    )
    return null
  }
}

function requireDesktopRelayService(runtimeRpc: OrcaRuntimeRpcServer): DesktopRelayService {
  const relayService = tryStartDesktopRelayService(runtimeRpc)
  if (!relayService) {
    throw new Error('pairing_context_unavailable')
  }
  return relayService
}

function createLazyPairingProvider(runtimeRpc: OrcaRuntimeRpcServer): MobileRelayPairingProvider {
  return {
    createPairingRelay: async (relayDeviceId) =>
      requireDesktopRelayService(runtimeRpc).createPairingRelay(relayDeviceId),
    onDeviceRevokeQueued: (item) => {
      tryStartDesktopRelayService(runtimeRpc)?.onDeviceRevokeQueued(item)
    },
    onDemandStateChanged: () => {
      tryStartDesktopRelayService(runtimeRpc)?.demandStateChanged()
    },
    getEndpoints: async (context, params) =>
      requireDesktopRelayService(runtimeRpc).getEndpoints(context, params),
    provisionRelay: async (context, params) =>
      requireDesktopRelayService(runtimeRpc).provisionRelay(context, params)
  }
}

function armAttachRetry(runtimeRpc: OrcaRuntimeRpcServer): void {
  if (attachRetryTimer || state.desktopRelayService || state.isQuitting) {
    return
  }
  const delayMs = ATTACH_RETRY_DELAYS_MS[attachRetryIndex]
  if (delayMs === undefined) {
    return
  }
  attachRetryIndex += 1
  attachRetryTimer = setTimeout(() => {
    attachRetryTimer = null
    if (tryStartDesktopRelayService(runtimeRpc)) {
      return
    }
    armAttachRetry(runtimeRpc)
  }, delayMs)
  attachRetryTimer.unref?.()
}

function armResume(runtimeRpc: OrcaRuntimeRpcServer): void {
  if (resumeHandler) {
    return
  }
  resumeHandler = () => {
    tryStartDesktopRelayService(runtimeRpc)?.ensureLive()
  }
  powerMonitor.on('resume', resumeHandler)
}

export function stopDesktopRelayStartup(): void {
  clearAttachRetry()
  if (resumeHandler) {
    powerMonitor.off('resume', resumeHandler)
    resumeHandler = null
  }
}

export function installDesktopRelayService(runtimeRpc: OrcaRuntimeRpcServer): void {
  const cloudAuth = getOrcaCloudAuthConfig()
  if (!cloudAuth.configured) {
    return
  }
  runtimeRpc.setMobileRelayPairingProvider(createLazyPairingProvider(runtimeRpc))
  if (!tryStartDesktopRelayService(runtimeRpc)) {
    armAttachRetry(runtimeRpc)
  }
  armResume(runtimeRpc)
}

export function notifyDesktopRelayAuthMutated(runtimeRpc: OrcaRuntimeRpcServer | null): void {
  if (!runtimeRpc || state.isQuitting) {
    return
  }
  tryStartDesktopRelayService(runtimeRpc)?.authMutated()
}
