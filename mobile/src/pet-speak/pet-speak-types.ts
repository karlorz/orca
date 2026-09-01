export type PetSpeakPayload = {
  type: 'pet.speak'
  text: string
  lang?: string
  event_id?: string
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

export type PreparedPetSpeakEventResult =
  | { status: 'prepared'; event: PetSpeakPayload }
  | { status: 'voice-unavailable' }

export type PetSpeakEventPreparer = (event: PetSpeakPayload) => Promise<PreparedPetSpeakEventResult>

export type PetSpeakCaption = {
  eventId: string
  text: string
}

export interface PetSpeakHandlerOptions {
  tts?: TtsAdapter
  mediaSession?: MediaSessionAdapter
  nativeAdapter?: PetSpeechNativeAdapter | null
  prepareEvent?: PetSpeakEventPreparer
  maxSeenEvents?: number
  maxQueueCapacity?: number
  onComplete?: (eventId: string, outcome: PetSpeakTerminalOutcome) => Promise<void>
  onCaption?: (caption: PetSpeakCaption | null) => void
}
