import {
  type PetSpeakTerminalOutcome,
  type TtsAdapter,
  type MediaSessionAdapter,
  type PetSpeechNativeAdapter,
  resolvePetLocale
} from './pet-speak-adapters'
import type { PetSpeakPayload } from './pet-speak-payload-validation'
import type { PetSpeakEventPreparer, PetSpeakCaption } from './pet-speak-types'
import {
  type PetSpeakAdmissionDecision,
  type PetSpeakBoundaryTimestamps,
  type PetSpeakCancelReason,
  normalizeAdmissionDecision,
  stampBoundary
} from './pet-speak-observability'

export type QueuedPetSpeakItem = {
  event: PetSpeakPayload
  resolve: () => void
  reject: (err: unknown) => void
  isCancelled: boolean
  cancelReason?: PetSpeakCancelReason
  trace: PetSpeakBoundaryTimestamps
}

export interface PetSpeakPlayHost {
  disposed: boolean
  prepareEvent?: PetSpeakEventPreparer
  nativeAdapter: PetSpeechNativeAdapter | null
  tts: TtsAdapter
  mediaSession: MediaSessionAdapter
  activeSessionId: string | null
  notifyCaption(caption: PetSpeakCaption | null): void
  emitComplete(
    eventId: string,
    outcome: PetSpeakTerminalOutcome,
    reason?: PetSpeakCancelReason,
    trace?: PetSpeakBoundaryTimestamps
  ): Promise<void>
}

export function captionForPetSpeak(
  eventId: string,
  text: string,
  originalText?: string
): PetSpeakCaption {
  const trimmed = originalText?.trim()
  return trimmed ? { eventId, text, originalText: trimmed } : { eventId, text }
}

export async function awaitPetSpeakAdmission(
  eventId: string,
  item: QueuedPetSpeakItem,
  onAccepted: (
    eventId: string,
    trace?: PetSpeakBoundaryTimestamps
  ) => Promise<boolean | PetSpeakAdmissionDecision>,
  timeoutMs: number,
  setAbort: (fn: (() => void) | null) => void
): Promise<PetSpeakAdmissionDecision> {
  stampBoundary(item.trace, 'acceptance_send')
  return await new Promise<PetSpeakAdmissionDecision>((resolve) => {
    let settled = false
    const finish = (decision: PetSpeakAdmissionDecision): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      setAbort(null)
      resolve(decision)
    }
    const abort = (reason: PetSpeakCancelReason): void => finish({ accepted: false, reason })
    const timer = setTimeout(() => abort('receipt_timeout'), timeoutMs)
    setAbort(() => abort('background_lifecycle'))
    void onAccepted(eventId, item.trace).then(
      (accepted) => finish(normalizeAdmissionDecision(accepted)),
      () => finish({ accepted: false, reason: 'transport_teardown' })
    )
  })
}

export function cancelReasonForPetSpeak(
  item: QueuedPetSpeakItem,
  outcome: PetSpeakTerminalOutcome,
  disposed: boolean
): PetSpeakCancelReason | undefined {
  if (outcome !== 'cancelled') {
    return undefined
  }
  if (item.cancelReason) {
    return item.cancelReason
  }
  if (disposed) {
    return 'background_lifecycle'
  }
  return 'tts_cancellation'
}

export async function playQueuedPetSpeakItem(
  host: PetSpeakPlayHost,
  item: QueuedPetSpeakItem
): Promise<void> {
  const rawEvent = item.event
  const text = rawEvent.text
  const eventId = rawEvent.event_id!

  if (host.disposed || item.isCancelled) {
    await host.emitComplete(
      eventId,
      'cancelled',
      cancelReasonForPetSpeak(item, 'cancelled', host.disposed),
      item.trace
    )
    item.resolve()
    return
  }

  let event = rawEvent
  if (host.prepareEvent) {
    try {
      const prepResult = await host.prepareEvent(rawEvent)
      if (host.disposed || item.isCancelled) {
        await host.emitComplete(
          eventId,
          'cancelled',
          cancelReasonForPetSpeak(item, 'cancelled', host.disposed),
          item.trace
        )
        item.resolve()
        return
      }
      if (prepResult.status === 'voice-unavailable') {
        await host.emitComplete(eventId, 'voice-unavailable', undefined, item.trace)
        item.resolve()
        return
      }
      event = prepResult.event
    } catch {
      const outcome = host.disposed || item.isCancelled ? 'cancelled' : 'voice-unavailable'
      await host.emitComplete(
        eventId,
        outcome,
        cancelReasonForPetSpeak(item, outcome, host.disposed),
        item.trace
      )
      item.resolve()
      return
    }
  }

  if (host.nativeAdapter) {
    try {
      host.notifyCaption(captionForPetSpeak(eventId, text, event.original_text))
      stampBoundary(item.trace, 'playback_start')
      const outcome = await host.nativeAdapter.speak(event)
      const finalOutcome = host.disposed || item.isCancelled ? 'cancelled' : outcome
      host.notifyCaption(null)
      await host.emitComplete(
        eventId,
        finalOutcome,
        cancelReasonForPetSpeak(item, finalOutcome, host.disposed),
        item.trace
      )
      item.resolve()
    } catch {
      const outcome = host.disposed || item.isCancelled ? 'cancelled' : 'playback-error'
      host.notifyCaption(null)
      await host.emitComplete(
        eventId,
        outcome,
        cancelReasonForPetSpeak(item, outcome, host.disposed),
        item.trace
      )
      item.resolve()
    }
    return
  }

  const availableVoices = await host.tts.getAvailableVoices().catch(() => [])
  const locale = resolvePetLocale(event.lang, availableVoices)
  let sessionId = ''
  try {
    sessionId = await host.mediaSession.startSession(text).catch(() => '')
    host.activeSessionId = sessionId
    if (!locale) {
      await host.emitComplete(eventId, 'voice-unavailable', undefined, item.trace)
      item.resolve()
      return
    }
    if (host.disposed || item.isCancelled) {
      await host.emitComplete(
        eventId,
        'cancelled',
        cancelReasonForPetSpeak(item, 'cancelled', host.disposed),
        item.trace
      )
      item.resolve()
      return
    }
    host.notifyCaption(captionForPetSpeak(eventId, text, event.original_text))
    stampBoundary(item.trace, 'playback_start')
    await host.tts.speak(text, locale)
    const outcome = host.disposed || item.isCancelled ? 'cancelled' : 'spoken'
    await host.emitComplete(
      eventId,
      outcome,
      cancelReasonForPetSpeak(item, outcome, host.disposed),
      item.trace
    )
    item.resolve()
  } catch {
    const outcome = host.disposed || item.isCancelled ? 'cancelled' : 'playback-error'
    await host.emitComplete(
      eventId,
      outcome,
      cancelReasonForPetSpeak(item, outcome, host.disposed),
      item.trace
    )
    item.resolve()
  } finally {
    host.notifyCaption(null)
    if (sessionId) {
      void host.mediaSession.stopSession(sessionId).catch(() => {})
    }
    if (host.activeSessionId === sessionId) {
      host.activeSessionId = null
    }
  }
}
