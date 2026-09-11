import type { PetVoiceLogger } from './pet-voice-logger'
import { parseSpeakIntentDecision, type PetSpeakEvent } from './pet-speak-intent'
import type { PetSpeakBoundaryTimestamps } from './pet-speak-observability'

export function dispatchPetVoiceSpeakIntent(
  message: Record<string, unknown>,
  audioSessionState: 'live' | 'dead',
  listeners: Iterable<(event: PetSpeakEvent) => void>,
  logger: PetVoiceLogger
): void {
  if (audioSessionState !== 'live') {
    return
  }
  const decision = parseSpeakIntentDecision(message)
  if (!decision.ok) {
    if (decision.reason === 'length') {
      logger.logSpeakIntentReject({
        ...(decision.event_id ? { event_id: decision.event_id } : {}),
        charsCount: decision.charsCount,
        reason: 'length'
      })
    }
    return
  }
  const { event, charsCount } = decision
  const eventId = event.event_id ?? ''
  const receiveAt = Date.now()
  logger.logSpeakIntent({
    event_id: eventId,
    charsCount,
    rate: event.rate
  })
  const inbound: PetSpeakBoundaryTimestamps = { relay_receive: receiveAt }
  if (typeof message.published_at === 'number' && Number.isFinite(message.published_at)) {
    inbound.grokpet_publish = message.published_at
    logger.logBoundary({
      event_id: eventId,
      boundary: 'grokpet_publish',
      timestamp: message.published_at
    })
  }
  logger.logBoundary({
    event_id: eventId,
    boundary: 'relay_receive',
    timestamp: receiveAt,
    timestamps: inbound
  })
  for (const listener of listeners) {
    try {
      listener(event)
    } catch (err) {
      logger.logEmitError({
        event_id: event.event_id ?? '',
        error: err instanceof Error ? err.message : String(err)
      })
      console.error('[pet-voice-relay] Listener error:', err)
    }
  }
}
