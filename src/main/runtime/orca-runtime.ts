import { installRuntimeLinearCommandSurface } from './runtime-linear-command-surface'
import { OrcaRuntimeWithResolveWaiter } from './orca-runtime-resolve-waiter'
import type { RuntimeCommandSurfaceHost } from './orca-runtime-core'
import { notifyRuntimeListeners } from './runtime-async-boundaries'
import { PetSpeakReplayBuffer, type ReplayablePetSpeakEvent } from './pet-speak-replay'
import type { PetSpeakEvent, PetSpeakOutcome, PetVoiceRelay } from './pet-voice-relay'
import { PetSpeechDeviceRegistry, type PetSpeechDeviceStatus } from './pet-speech-status-registry'
import type { PetVoiceSubscriptionTracker } from './pet-voice-subscription-tracker'

class OrcaRuntimeService extends OrcaRuntimeWithResolveWaiter {
  private petSpeakListeners = new Set<(event: ReplayablePetSpeakEvent) => void>()
  private petVoiceSubscriptionTracker: PetVoiceSubscriptionTracker | null = null
  private readonly petSpeakReplay = new PetSpeakReplayBuffer()
  private petSpeakCompleteHandler:
    | ((eventId: string, outcome: PetSpeakOutcome) => Promise<{ completed: boolean }>)
    | null = null
  private petVoiceRelay: PetVoiceRelay | null = null
  private readonly petSpeechDeviceRegistry = new PetSpeechDeviceRegistry()

  setPetVoiceSubscriptionTracker(tracker: PetVoiceSubscriptionTracker | null): void {
    this.petVoiceSubscriptionTracker = tracker
  }

  getPetVoiceSubscriptionTracker(): PetVoiceSubscriptionTracker | null {
    return this.petVoiceSubscriptionTracker
  }

  onPetSpeakDispatched(listener: (event: ReplayablePetSpeakEvent) => void): () => void {
    this.petSpeakListeners.add(listener)
    return () => {
      this.petSpeakListeners.delete(listener)
    }
  }

  dispatchPetSpeak(event: PetSpeakEvent): void {
    const recorded = this.petSpeakReplay.record(event)
    notifyRuntimeListeners(this.petSpeakListeners, (listener) => listener(recorded), 'pet-speak')
  }

  getMissedPetSpeakSince(lastSeenSeq: number, epoch?: string): ReplayablePetSpeakEvent[] {
    return this.petSpeakReplay.getMissedSince(lastSeenSeq, epoch)
  }

  getPetSpeakEpoch(): string {
    return this.petSpeakReplay.epoch
  }

  setPetSpeakCompleteHandler(
    handler: ((eventId: string, outcome: PetSpeakOutcome) => Promise<{ completed: boolean }>) | null
  ): void {
    this.petSpeakCompleteHandler = handler
  }

  setPetVoiceRelay(relay: PetVoiceRelay | null): void {
    this.petVoiceRelay = relay
  }

  async handlePetSpeakComplete(
    eventId: string,
    outcome: PetSpeakOutcome
  ): Promise<{ completed: boolean }> {
    if (this.petSpeakCompleteHandler) {
      return await this.petSpeakCompleteHandler(eventId, outcome)
    }
    return { completed: false }
  }

  getPetSpeechDeviceRegistry(): PetSpeechDeviceRegistry {
    return this.petSpeechDeviceRegistry
  }

  async handlePetSpeechStatus(
    status: PetSpeechDeviceStatus,
    connectionId?: string
  ): Promise<{ acknowledged: boolean }> {
    this.petSpeechDeviceRegistry.reportStatus(status, connectionId)
    if (this.petVoiceRelay) {
      await this.petVoiceRelay.sendDeviceStatus(status, connectionId)
    }
    return { acknowledged: true }
  }
}
type OrcaRuntimeServiceExport = RuntimeCommandSurfaceHost<OrcaRuntimeService>
const OrcaRuntimeServiceExport = OrcaRuntimeService as unknown as {
  new (...args: ConstructorParameters<typeof OrcaRuntimeService>): OrcaRuntimeServiceExport
  readonly prototype: OrcaRuntimeServiceExport
}
export { OrcaRuntimeServiceExport as OrcaRuntimeService }
installRuntimeLinearCommandSurface(OrcaRuntimeServiceExport.prototype)

export type { LegacyWorkerTerminalRecoveryResult } from './runtime-legacy-worker-terminal-recovery-types'
export type {
  RuntimeAutomationCreateInput,
  RuntimeAutomationUpdateInput
} from './runtime-automation-controller'
export type { SubscriptionRegistration } from './runtime-subscription-registry'
export type {
  OrchestrationCompatibilityCallerAuthority,
  OrchestrationCompatibilityTerminalAuthority,
  RuntimePtyDataAdmission,
  RuntimeTerminalAgentStatusEvent
} from './runtime-terminal-contracts'
export type { MessageWaitResult } from './runtime-message-waiters'
export type { AccountsSnapshot, CodexRateLimitResetRpcResult } from './runtime-account-controller'
export type {
  MobileNotificationDispatchEvent,
  MobileNotificationDismissEvent,
  MobileNotificationEvent
} from './runtime-mobile-notification-controller'
export type { RuntimeTerminalDataMeta } from './runtime-terminal-stream-consumers'
export type { RemoteFetchResult, RemoteTrackingBase } from './runtime-remote-fetch-controller'
export {
  computeTerminalTailWaitState,
  tailGainedNewerBlockedReason,
  type TerminalTailWaitState
} from './terminal-wait-tail-state'
export { appendNormalizedToTailBuffer } from './terminal-tail-buffer'
export { appendNormalizedToMultilineTailBufferUnwindowed } from './terminal-tail-redraw-buffer'
export { buildPreview } from './terminal-tail-state'
export { buildRestoredTerminalTailSeed } from './terminal-tail-restore-seed'
export { projectTerminalTailLines } from './orca-runtime-terminal-projection'
export { resolveWorktreeScanCacheTtlMs } from './runtime-worktree-scan-cache'
export type {
  RuntimeWorktreeLifecycleEvent,
  DriverState,
  PtyLayoutTarget,
  PtyLayoutState,
  ApplyLayoutResult,
  RuntimeRendererReloadFence
} from './orca-runtime-core'
export {
  AUTHORITATIVE_TERMINAL_SNAPSHOT_TIMEOUT_MS,
  WORKTREE_SCAN_ADMIN_RECONCILE_INTERVAL_MS,
  WORKTREE_SCAN_ADMIN_FINGERPRINT_TIMEOUT_MS
} from './orca-runtime-postlude'
