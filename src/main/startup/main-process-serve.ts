import { app } from 'electron'
import { notifyServeSupervisorReady } from '../serve-update-handoff'
import { clearServeAbortPark } from '../../shared/serve-abort-park'
import { findBundledWebClientRoot } from '../../shared/bundled-web-client-root'
import { buildServePairingReadiness, servePublishMode } from '../server/serve-pairing-readiness'
import { mainProcessState as state } from './main-process-state'
import { getServeOptions, type ServeOptions } from './serve-options'
import { warnIfSiblingProfileRuntimeLive } from '../runtime/sibling-profile-runtime-warning'

export { getServeOptions, type ServeOptions }

export function getBundledWebClientRoot(): string | undefined {
  return findBundledWebClientRoot(app.getAppPath())
}

export async function printServeReady(options: ServeOptions): Promise<void> {
  const runtime = state.runtime
  const runtimeRpc = state.runtimeRpc
  if (!runtime || !runtimeRpc) {
    throw new Error('Runtime server must be initialized before printing serve readiness')
  }
  // Validate project root before pairing publication can persist a pending device.
  const output = servePublishMode(options)
  await state.serveReadinessPublisher.publish(
    {
      runtimeId: runtime.getRuntimeId(),
      ...(await buildServePairingReadiness(options, runtimeRpc)),
      // WSL barrier fails open; pending warns clients PTY launch may still race repair.
      managedWslCliReconciliation: state.managedWslCliReconciliationStatus
    },
    output
  )
  notifyServeSupervisorReady(runtime.getRuntimeId())
  warnIfSiblingProfileRuntimeLive({ thisUserDataPath: app.getPath('userData') })
  // Why: a serve that got this far proves this environment can launch it after all.
  clearServeAbortPark(app.getPath('userData'))
}
