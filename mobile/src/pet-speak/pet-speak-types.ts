export type PetSpeakPayload = {
  type: 'pet.speak'
  text: string
  lang?: string
  event_id?: string
  rate?: number
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

export interface PetSpeakHandlerOptions {
  tts?: TtsAdapter
  mediaSession?: MediaSessionAdapter
  nativeAdapter?: PetSpeechNativeAdapter | null
  maxSeenEvents?: number
  maxQueueCapacity?: number
  onComplete?: (eventId: string, outcome: PetSpeakTerminalOutcome) => Promise<void>
}
