import { OrcaRuntimeWithSidebarTemporal } from './sidebar-inputs/orca-runtime-sidebar-temporal'
import { OrcaRuntimeWithAgentTransitions } from './orca-runtime-agent-transitions'
import { ORCA_SIDEBAR_INPUTS_IS_MAIN } from '../../shared/sidebar-inputs-switch'
import { notifyRuntimeListeners } from './runtime-async-boundaries'
import { PetSpeakReplayBuffer, type ReplayablePetSpeakEvent } from './pet-speak-replay'
import type { PetSpeakEvent, PetSpeakOutcome, PetVoiceRelay } from './pet-voice-relay'
import type { PetSpeakCancelReason } from './pet-speak-observability'
import { PetSpeechDeviceRegistry, type PetSpeechDeviceStatus } from './pet-speech-status-registry'
import type { PetVoiceSubscriptionTracker } from './pet-voice-subscription-tracker'

const OrcaRuntimePetSpeakBase: typeof OrcaRuntimeWithAgentTransitions = ORCA_SIDEBAR_INPUTS_IS_MAIN
  ? OrcaRuntimeWithSidebarTemporal
  : OrcaRuntimeWithAgentTransitions

export abstract class OrcaRuntimeWithPetSpeak extends OrcaRuntimePetSpeakBase {
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
}
