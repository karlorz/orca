import { Platform } from 'react-native'
import {
  type PetSpeakSubscribeResult,
  type PetSpeakTerminalOutcome,
  type TtsAdapter,
  type MediaSessionAdapter,
  type PetSpeechNativeAdapter,
  resolvePetLocale,
  DefaultTtsAdapter,
  DefaultExpoNotificationMediaSessionAdapter,
  getPetSpeechNativeAdapter
} from './pet-speak-adapters'
import { type PetSpeakPayload, isValidPetSpeakPayload } from './pet-speak-payload-validation'
import type { PetSpeakHandlerOptions } from './pet-speak-types'

export {
  type PetSpeakPayload,
  type PetSpeakSubscribeResult,
  type PetSpeakTerminalOutcome,
  type TtsAdapter,
  type MediaSessionAdapter,
  type PetSpeechNativeAdapter,
  type PetSpeakHandlerOptions,
  resolvePetLocale,
  DefaultTtsAdapter,
  DefaultExpoNotificationMediaSessionAdapter,
  isValidPetSpeakPayload
}

type QueuedItem = {
  event: PetSpeakPayload
  resolve: () => void
  reject: (err: unknown) => void
  isCancelled: boolean
}

export class PetSpeakHandler {
  private readonly tts: TtsAdapter
  private readonly mediaSession: MediaSessionAdapter
  private readonly nativeAdapter: PetSpeechNativeAdapter | null
  private readonly seenEventIds = new Set<string>()
  private readonly inFlightPromises = new Map<string, Promise<void>>()
  private readonly maxSeenEvents: number
  private readonly maxQueueCapacity: number
  private readonly onComplete?: (eventId: string, outcome: PetSpeakTerminalOutcome) => Promise<void>
  private queue: QueuedItem[] = []
  private activeItem: QueuedItem | null = null
  private isProcessing = false
  private disposed = false
  private activeSessionId: string | null = null

  constructor(options?: PetSpeakHandlerOptions) {
    this.tts = options?.tts ?? new DefaultTtsAdapter()
    this.mediaSession = options?.mediaSession ?? new DefaultExpoNotificationMediaSessionAdapter()
    this.nativeAdapter =
      options?.nativeAdapter !== undefined
        ? options.nativeAdapter
        : Platform.OS === 'android'
          ? getPetSpeechNativeAdapter()
          : null
    this.maxSeenEvents = options?.maxSeenEvents ?? 256
    this.maxQueueCapacity = options?.maxQueueCapacity ?? 16
    this.onComplete = options?.onComplete
  }

  async handleEvent(event: PetSpeakPayload | null | undefined): Promise<void> {
    if (!isValidPetSpeakPayload(event)) {
      return
    }

    const eventId = event.event_id!.trim()
    const text = event.text.trim()

    const inFlight = this.inFlightPromises.get(eventId)
    if (inFlight) {
      return inFlight
    }
    if (this.seenEventIds.has(eventId)) {
      return
    }

    if (this.disposed) {
      this.recordSeenId(eventId)
      if (this.onComplete) {
        await this.onComplete(eventId, 'cancelled').catch(() => {})
      }
      return
    }

    const currentTotal = (this.activeItem ? 1 : 0) + this.queue.length
    if (currentTotal >= this.maxQueueCapacity) {
      this.recordSeenId(eventId)
      if (this.onComplete) {
        await this.onComplete(eventId, 'cancelled').catch(() => {})
      }
      return
    }

    this.recordSeenId(eventId)

    const handlePromise = new Promise<void>((resolve, reject) => {
      this.queue.push({
        event: { ...event, text, event_id: eventId },
        resolve,
        reject,
        isCancelled: false
      })
      void this.processQueue()
    })

    this.inFlightPromises.set(eventId, handlePromise)
    handlePromise.finally(() => {
      this.inFlightPromises.delete(eventId)
    })

    return handlePromise
  }

  private recordSeenId(id: string): void {
    this.seenEventIds.add(id)
    if (this.seenEventIds.size > this.maxSeenEvents) {
      const first = this.seenEventIds.values().next().value
      if (first) {
        this.seenEventIds.delete(first)
      }
    }
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) {
      return
    }
    this.isProcessing = true

    while (this.queue.length > 0) {
      const item = this.queue.shift()
      if (!item) {
        break
      }
      this.activeItem = item

      if (this.disposed || item.isCancelled) {
        if (item.event.event_id && this.onComplete) {
          await this.onComplete(item.event.event_id, 'cancelled').catch(() => {})
        }
        item.resolve()
        this.activeItem = null
        continue
      }

      await this.playItem(item)
      this.activeItem = null
    }

    this.isProcessing = false
  }

  private async playItem(item: QueuedItem): Promise<void> {
    const event = item.event
    const text = event.text
    const eventId = event.event_id!

    if (this.disposed || item.isCancelled) {
      if (this.onComplete) {
        await this.onComplete(eventId, 'cancelled').catch(() => {})
      }
      item.resolve()
      return
    }

    if (this.nativeAdapter) {
      try {
        const outcome = await this.nativeAdapter.speak(event)
        const finalOutcome: PetSpeakTerminalOutcome =
          this.disposed || item.isCancelled ? 'cancelled' : outcome
        if (this.onComplete) {
          await this.onComplete(eventId, finalOutcome).catch(() => {})
        }
        item.resolve()
      } catch {
        const outcome: PetSpeakTerminalOutcome =
          this.disposed || item.isCancelled ? 'cancelled' : 'playback-error'
        if (this.onComplete) {
          await this.onComplete(eventId, outcome).catch(() => {})
        }
        item.resolve()
      }
      return
    }

    const availableVoices = await this.tts.getAvailableVoices().catch(() => [])
    const locale = resolvePetLocale(event.lang, availableVoices)

    let sessionId = ''
    try {
      sessionId = await this.mediaSession.startSession(text).catch(() => '')
      this.activeSessionId = sessionId

      if (!locale) {
        if (this.onComplete) {
          await this.onComplete(eventId, 'voice-unavailable').catch(() => {})
        }
        item.resolve()
        return
      }

      if (this.disposed || item.isCancelled) {
        if (this.onComplete) {
          await this.onComplete(eventId, 'cancelled').catch(() => {})
        }
        item.resolve()
        return
      }

      await this.tts.speak(text, locale)
      const outcome: PetSpeakTerminalOutcome =
        this.disposed || item.isCancelled ? 'cancelled' : 'spoken'
      if (this.onComplete) {
        await this.onComplete(eventId, outcome).catch(() => {})
      }
      item.resolve()
    } catch {
      const outcome: PetSpeakTerminalOutcome =
        this.disposed || item.isCancelled ? 'cancelled' : 'playback-error'
      if (this.onComplete) {
        await this.onComplete(eventId, outcome).catch(() => {})
      }
      item.resolve()
    } finally {
      if (sessionId) {
        await this.mediaSession.stopSession(sessionId).catch(() => {})
      }
      if (this.activeSessionId === sessionId) {
        this.activeSessionId = null
      }
    }
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true

    if (this.activeItem) {
      this.activeItem.isCancelled = true
    }

    const pending = [...this.queue]
    this.queue = []

    for (const item of pending) {
      item.isCancelled = true
      if (item.event.event_id && this.onComplete) {
        void this.onComplete(item.event.event_id, 'cancelled').catch(() => {})
      }
      item.resolve()
    }

    if (this.activeSessionId) {
      void this.mediaSession.stopSession(this.activeSessionId).catch(() => {})
      this.activeSessionId = null
    }
    if (this.nativeAdapter?.stop) {
      void this.nativeAdapter.stop().catch(() => {})
    }
    if (this.tts.stop) {
      void this.tts.stop().catch(() => {})
    }
  }
}
