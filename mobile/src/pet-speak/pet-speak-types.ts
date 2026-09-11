export type PetSpeakPayload = {
  type: 'pet.speak'
  text: string
  lang?: string
  event_id?: string
  original_text?: string
  rate?: number
  voiceName?: string
  playerKind?: 'mediaplayer' | 'media3'
  debug?: boolean
  seq?: number
  epoch?: string
  replayed?: boolean
}

export type PetSpeakSubscribeResult = {
  type: 'ready'
  subscriptionId: string
  epoch?: string
}

import type {
  PetSpeakTerminalOutcome,
  TtsAdapter,
  MediaSessionAdapter,
  PetSpeechNativeAdapter
} from './pet-speak-adapters'
import type {
  PetSpeakAdmissionDecision,
  PetSpeakBoundaryTimestamps,
  PetSpeakCancelReason
} from './pet-speak-observability'

export type PreparedPetSpeakEventResult =
  | { status: 'prepared'; event: PetSpeakPayload }
  | { status: 'voice-unavailable' }

export type PetSpeakEventPreparer = (event: PetSpeakPayload) => Promise<PreparedPetSpeakEventResult>

export type PetSpeakCaption = {
  eventId: string
  text: string
  originalText?: string
}

export interface PetSpeakHandlerOptions {
  tts?: TtsAdapter
  mediaSession?: MediaSessionAdapter
  nativeAdapter?: PetSpeechNativeAdapter | null
  prepareEvent?: PetSpeakEventPreparer
  maxSeenEvents?: number
  maxQueueCapacity?: number
  admissionTimeoutMs?: number
  onAccepted?: (
    eventId: string,
    timestamps?: PetSpeakBoundaryTimestamps
  ) => Promise<boolean | PetSpeakAdmissionDecision>
  onComplete?: (
    eventId: string,
    outcome: PetSpeakTerminalOutcome,
    reason?: PetSpeakCancelReason,
    timestamps?: PetSpeakBoundaryTimestamps
  ) => Promise<void>
  onCaption?: (caption: PetSpeakCaption | null) => void
  /** When set, event_id is claimed process-wide so a second host cannot play or clear captions. */
  crossHostOwnerId?: string
}
