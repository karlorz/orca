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
import {
  type PetSpeakPayload,
  inspectPetSpeakPayload,
  isValidPetSpeakPayload
} from './pet-speak-payload-validation'
import type {
  PetSpeakHandlerOptions,
  PetSpeakEventPreparer,
  PetSpeakCaption
} from './pet-speak-types'
import { createSeenGuard } from '../storage/watermark-storage'
import {
  applyOwnedPetSpeakCaption,
  claimPetSpeakEvent,
  releasePetSpeakEvent
} from './pet-speak-cross-host'
import {
  type PetSpeakBoundaryTimestamps,
  type PetSpeakCancelReason,
  compactBoundaryTimestamps,
  stampBoundary
} from './pet-speak-observability'
import {
  type PetSpeakPlayHost,
  type QueuedPetSpeakItem,
  awaitPetSpeakAdmission,
  playQueuedPetSpeakItem
} from './pet-speak-play-item'

export {
  type PetSpeakPayload,
  type PetSpeakSubscribeResult,
  type PetSpeakTerminalOutcome,
  type TtsAdapter,
  type MediaSessionAdapter,
  type PetSpeechNativeAdapter,
  type PetSpeakCaption,
  type PetSpeakHandlerOptions,
  type PetSpeakEventPreparer,
  resolvePetLocale,
  DefaultTtsAdapter,
  DefaultExpoNotificationMediaSessionAdapter,
  isValidPetSpeakPayload,
  type QueuedPetSpeakItem
}

export class PetSpeakHandler implements PetSpeakPlayHost {
  readonly tts: TtsAdapter
  readonly mediaSession: MediaSessionAdapter
  readonly nativeAdapter: PetSpeechNativeAdapter | null
  readonly prepareEvent?: PetSpeakEventPreparer
  private readonly seenEventIds: ReturnType<typeof createSeenGuard>
  private readonly seenSeqs: ReturnType<typeof createSeenGuard>
  private readonly inFlightPromises = new Map<string, Promise<void>>()
  private readonly maxQueueCapacity: number
  private readonly admissionTimeoutMs: number
  private readonly onAccepted?: PetSpeakHandlerOptions['onAccepted']
  private readonly onComplete?: PetSpeakHandlerOptions['onComplete']
  private readonly onCaption?: (caption: PetSpeakCaption | null) => void
  private readonly crossHostOwnerId?: string
  private queue: QueuedPetSpeakItem[] = []
  private activeItem: QueuedPetSpeakItem | null = null
  private isProcessing = false
  disposed = false
  private abortPendingAdmission: (() => void) | null = null
  activeSessionId: string | null = null
  private activeCaptionEventId: string | null = null

  constructor(options?: PetSpeakHandlerOptions) {
    this.tts = options?.tts ?? new DefaultTtsAdapter()
    this.mediaSession = options?.mediaSession ?? new DefaultExpoNotificationMediaSessionAdapter()
    this.nativeAdapter =
      options?.nativeAdapter !== undefined
        ? options.nativeAdapter
        : Platform.OS === 'android'
          ? getPetSpeechNativeAdapter()
          : null
    this.prepareEvent = options?.prepareEvent
    const maxSeen = options?.maxSeenEvents ?? 256
    this.seenEventIds = createSeenGuard(maxSeen)
    this.seenSeqs = createSeenGuard(maxSeen)
    this.maxQueueCapacity = options?.maxQueueCapacity ?? 16
    this.admissionTimeoutMs = options?.admissionTimeoutMs ?? 3000
    this.onAccepted = options?.onAccepted
    this.onComplete = options?.onComplete
    this.onCaption = options?.onCaption
    this.crossHostOwnerId = options?.crossHostOwnerId
  }

  async handleEvent(
    rawEvent: PetSpeakPayload | null | undefined,
    options?: { socketReceivedAt?: number }
  ): Promise<void> {
    const decision = inspectPetSpeakPayload(rawEvent)
    if (!decision.ok) {
      if (decision.reason === 'length') {
        console.warn('[pet-speak] Dropped event exceeding length limit:', {
          event_id: decision.event_id,
          textLength: decision.textLength
        })
      }
      return
    }
    const event = decision.payload

    if (event.replayed) {
      console.log('[pet-speak] replayed', event.seq, event.event_id)
    }

    const eventId = event.event_id!.trim()
    const text = event.text.trim()

    if (event.seq !== undefined && event.epoch) {
      const seqKey = `${event.epoch}:${event.seq}`
      if (this.seenSeqs.has(seqKey)) {
        return
      }
      this.seenSeqs.add(seqKey)
    }

    const inFlight = this.inFlightPromises.get(eventId)
    if (inFlight) {
      return inFlight
    }
    if (this.seenEventIds.has(eventId)) {
      return
    }

    if (this.disposed) {
      this.seenEventIds.add(eventId)
      await this.emitComplete(eventId, 'cancelled', 'background_lifecycle')
      return
    }

    if (this.crossHostOwnerId && !claimPetSpeakEvent(eventId, this.crossHostOwnerId)) {
      this.seenEventIds.add(eventId)
      // Skip pet.speak.complete: GrokPet treats the first complete as the mobile
      // leg, so a queue_replacement nack would cancel the owning host before it
      // can admit and play.
      return
    }

    const currentTotal = (this.activeItem ? 1 : 0) + this.queue.length
    if (currentTotal >= this.maxQueueCapacity) {
      this.seenEventIds.add(eventId)
      await this.emitComplete(eventId, 'cancelled', 'capacity_rejection')
      return
    }

    this.seenEventIds.add(eventId)
    const trace: PetSpeakBoundaryTimestamps = {}
    if (typeof options?.socketReceivedAt === 'number') {
      stampBoundary(trace, 'mobile_socket_receive', options.socketReceivedAt)
    }
    stampBoundary(trace, 'mobile_queue_admission')
    const handlePromise = new Promise<void>((resolve, reject) => {
      this.queue.push({
        event: { ...event, text, event_id: eventId },
        resolve,
        reject,
        isCancelled: false,
        trace
      })
      void this.processQueue()
    })

    this.inFlightPromises.set(eventId, handlePromise)
    handlePromise.finally(() => this.inFlightPromises.delete(eventId))
    return handlePromise
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
        if (item.event.event_id) {
          await this.emitComplete(
            item.event.event_id,
            'cancelled',
            item.cancelReason ?? (this.disposed ? 'background_lifecycle' : 'operator_interruption'),
            item.trace
          )
        }
        item.resolve()
        this.activeItem = null
        continue
      }

      const eventId = item.event.event_id!
      const decision = this.onAccepted
        ? await awaitPetSpeakAdmission(
            eventId,
            item,
            this.onAccepted,
            this.admissionTimeoutMs,
            (fn) => {
              this.abortPendingAdmission = fn
            }
          )
        : { accepted: true }
      if (!decision.accepted || this.disposed || item.isCancelled) {
        await this.emitComplete(
          eventId,
          'cancelled',
          item.cancelReason ?? (this.disposed ? 'background_lifecycle' : decision.reason),
          item.trace
        )
        item.resolve()
        this.activeItem = null
        continue
      }

      await playQueuedPetSpeakItem(this, item)
      this.activeItem = null
    }

    this.isProcessing = false
  }

  async emitComplete(
    eventId: string,
    outcome: PetSpeakTerminalOutcome,
    reason?: PetSpeakCancelReason,
    trace: PetSpeakBoundaryTimestamps = {}
  ): Promise<void> {
    if (this.crossHostOwnerId) {
      releasePetSpeakEvent(eventId, this.crossHostOwnerId)
    }
    stampBoundary(trace, outcome === 'cancelled' ? 'cancellation_send' : 'completion_send')
    if (!this.onComplete) {
      return
    }
    await this.onComplete(
      eventId,
      outcome,
      outcome === 'cancelled' ? reason : undefined,
      compactBoundaryTimestamps(trace)
    ).catch(() => {})
  }

  notifyCaption(caption: PetSpeakCaption | null): void {
    if (this.crossHostOwnerId) {
      if (!applyOwnedPetSpeakCaption(caption, this.crossHostOwnerId)) {
        return
      }
    } else if (!caption && this.activeCaptionEventId === null) {
      return
    } else {
      this.activeCaptionEventId = caption?.eventId ?? null
    }
    this.onCaption?.(caption)
  }

  cancelInFlightUtterance(reason: PetSpeakCancelReason = 'operator_interruption'): void {
    this.notifyCaption(null)
    if (this.activeItem) {
      this.activeItem.isCancelled = true
      this.activeItem.cancelReason = reason
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

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    this.abortPendingAdmission?.()
    this.cancelInFlightUtterance('background_lifecycle')
    const pending = [...this.queue]
    this.queue = []
    for (const item of pending) {
      item.isCancelled = true
      item.cancelReason = 'background_lifecycle'
      if (item.event.event_id) {
        void this.emitComplete(item.event.event_id, 'cancelled', 'background_lifecycle', item.trace)
      }
      item.resolve()
    }
  }
}
