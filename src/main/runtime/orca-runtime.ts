import { installRuntimeLinearCommandSurface } from './runtime-linear-command-surface'
import { OrcaRuntimeWithMigrationCatalog } from './orca-runtime-migration-catalog'
import type { RuntimeCommandSurfaceHost } from './orca-runtime-core'
import type {
  AgentLaunchTabPublished,
  AgentLaunchTabPublishRequest
} from '../../shared/agent-launch-tab-publication'
import type {
  AgentLaunchPaneAddress,
  AgentLaunchPaneVerdict
} from '../../shared/agent-launch-pane-verdict'
import { registerWorktreeChangeInvalidator } from '../ipc/worktree-change-invalidators'
import type { AgentSessionRecordStore } from './agent-session-record-store'
import { peekOpenedAgentSessionRecordStore } from './agent-session-record-store-slot'
import { createAgentLaunchRecordWarmupGate } from './agent-launch-record-warmup-gate'
import { registerDetectedWorktreeScanInvalidation } from '../ipc/worktrees/listing/register-detected-worktree-scan-invalidation'
import { notifyRuntimeListeners } from './runtime-async-boundaries'
import { PetSpeakReplayBuffer, type ReplayablePetSpeakEvent } from './pet-speak-replay'
import type { PetSpeakEvent, PetSpeakOutcome, PetVoiceRelay } from './pet-voice-relay'
import type { PetSpeakCancelReason } from './pet-speak-observability'
import { PetSpeechDeviceRegistry, type PetSpeechDeviceStatus } from './pet-speech-status-registry'
import type { PetVoiceSubscriptionTracker } from './pet-voice-subscription-tracker'

class OrcaRuntimeService extends OrcaRuntimeWithMigrationCatalog {
  constructor(...args: ConstructorParameters<typeof OrcaRuntimeWithMigrationCatalog>) {
    super(...args)
    // Why: a worktree change must invalidate both the listing generation and this runtime's scan cache.
    registerDetectedWorktreeScanInvalidation()
    registerWorktreeChangeInvalidator((repoId) => this.invalidateWorktreeCatalog(repoId))
  }

  private petSpeakListeners = new Set<(event: ReplayablePetSpeakEvent) => void>()
  private petVoiceSubscriptionTracker: PetVoiceSubscriptionTracker | null = null
  private readonly petSpeakReplay = new PetSpeakReplayBuffer()
  private petSpeakCompleteHandler:
    | ((
        eventId: string,
        outcome: PetSpeakOutcome,
        reason?: PetSpeakCancelReason
      ) => Promise<{ completed: boolean }>)
    | null = null
  private petSpeakAcceptedHandler: ((eventId: string) => Promise<{ accepted: boolean }>) | null =
    null
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
    handler:
      | ((
          eventId: string,
          outcome: PetSpeakOutcome,
          reason?: PetSpeakCancelReason
        ) => Promise<{ completed: boolean }>)
      | null
  ): void {
    this.petSpeakCompleteHandler = handler
  }

  setPetSpeakAcceptedHandler(
    handler: ((eventId: string) => Promise<{ accepted: boolean }>) | null
  ): void {
    this.petSpeakAcceptedHandler = handler
  }

  setPetVoiceRelay(relay: PetVoiceRelay | null): void {
    this.petVoiceRelay = relay
  }

  getPetVoiceRelay(): PetVoiceRelay | null {
    return this.petVoiceRelay
  }

  async handlePetSpeakComplete(
    eventId: string,
    outcome: PetSpeakOutcome,
    reason?: PetSpeakCancelReason
  ): Promise<{ completed: boolean }> {
    if (this.petSpeakCompleteHandler) {
      return reason
        ? await this.petSpeakCompleteHandler(eventId, outcome, reason)
        : await this.petSpeakCompleteHandler(eventId, outcome)
    }
    return { completed: false }
  }

  async handlePetSpeakAccepted(eventId: string): Promise<{ accepted: boolean }> {
    if (this.petSpeakAcceptedHandler) {
      return await this.petSpeakAcceptedHandler(eventId)
    }
    return { accepted: false }
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

  /** Whether a window owns the layout and can show a launch's tab ahead of its process. */
  canPublishAgentLaunchTab(): boolean {
    return Boolean(this.notifier?.publishAgentLaunchTab && this.getAvailableAuthoritativeWindow())
  }

  /** Shows an agent launch's tab before its process exists, in the window that owns the layout;
   *  null when no window does, and the launch's tab then appears when it spawns, as before. */
  publishAgentLaunchTab(
    request: Omit<AgentLaunchTabPublishRequest, 'requestId'>
  ): Promise<AgentLaunchTabPublished> | null {
    if (!this.notifier?.publishAgentLaunchTab || !this.getAvailableAuthoritativeWindow()) {
      return null
    }
    return this.notifier.publishAgentLaunchTab(request)
  }

  /** Tells the window a launch pane's fate: it keeps a final one on the tab, clears a settled one,
   *  and takes a withdrawn pane back (the pane alone when the user split the tab). */
  reportAgentLaunchPaneVerdict(
    pane: AgentLaunchPaneAddress,
    verdict: AgentLaunchPaneVerdict
  ): void {
    this.notifier?.agentLaunchPaneVerdict?.({ ...pane, verdict })
  }

  private readonly agentLaunchRecordWarmup = createAgentLaunchRecordWarmupGate({
    isOpen: () => peekOpenedAgentSessionRecordStore() !== null,
    open: () => this.openAgentSessionRecordStore()
  })

  /** Startup is done; the launch record may open once a client that can launch is here too. */
  noteAgentLaunchStartupSettled(): void {
    this.agentLaunchRecordWarmup.startupSettled()
  }

  /** A client that can call `agent.launch` connected; its first launch should not open the record. */
  noteAgentLaunchClientReady(): void {
    this.agentLaunchRecordWarmup.launchClientReady()
  }

  /** Whether a running process holds this pane now: such a pane is attached to, never launched into. */
  hasLiveTerminalForPaneKey(paneKey: string): boolean {
    return this.getPtyRecordForPaneKey(paneKey)?.connected === true
  }

  /** The launch record when it is already open, for a reader that must not wait for it. */
  openedAgentSessionRecordStore(): AgentSessionRecordStore | null {
    return peekOpenedAgentSessionRecordStore()
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
