export type { PetSpeakPayload, PetSpeakSubscribeResult } from './pet-speak-types'
import type { PetSpeakPayload } from './pet-speak-types'
import { normalizePetLanguage } from './pet-language-normalizer'
import { PET_SPEAK_MAX_TEXT_GRAPHEMES } from '../../../src/shared/pet-speak-limits'

export {
  normalizePetLanguage,
  CANONICAL_LANGUAGES,
  type CanonicalLanguage
} from './pet-language-normalizer'

export const PET_SPEAK_DEFAULT_RATE = 1.2
export const PET_SPEAK_MIN_RATE = 0.5
export const PET_SPEAK_MAX_RATE = 2.5

export function parsePetSpeakRate(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN
  if (!Number.isFinite(n)) {
    return PET_SPEAK_DEFAULT_RATE
  }
  return Math.min(PET_SPEAK_MAX_RATE, Math.max(PET_SPEAK_MIN_RATE, Math.round(n * 100) / 100))
}

export type PetSpeakValidationDecision =
  | { ok: true; payload: PetSpeakPayload }
  | {
      ok: false
      reason: 'type' | 'text_empty' | 'length' | 'event_id' | 'lang' | 'voiceName' | 'debug'
      event_id?: string
      textLength?: number
    }

export function inspectPetSpeakPayload(event: unknown): PetSpeakValidationDecision {
  if (!event || typeof event !== 'object') {
    return { ok: false, reason: 'type' }
  }
  const candidate = event as Record<string, unknown>
  if (candidate.type !== 'pet.speak') {
    return { ok: false, reason: 'type' }
  }
  const eventId =
    typeof candidate.event_id === 'string' && candidate.event_id.trim()
      ? candidate.event_id.trim()
      : undefined

  if (typeof candidate.text !== 'string') {
    return { ok: false, reason: 'text_empty', ...(eventId ? { event_id: eventId } : {}) }
  }
  const trimmed = candidate.text.trim()
  const textLength = Array.from(trimmed).length
  if (textLength === 0) {
    return {
      ok: false,
      reason: 'text_empty',
      ...(eventId ? { event_id: eventId } : {}),
      textLength: 0
    }
  }
  if (textLength > PET_SPEAK_MAX_TEXT_GRAPHEMES) {
    return {
      ok: false,
      reason: 'length',
      ...(eventId ? { event_id: eventId } : {}),
      textLength
    }
  }

  // event_id must be non-empty string <= 128 Unicode characters
  if (!eventId) {
    return { ok: false, reason: 'event_id' }
  }
  const eventIdLength = Array.from(eventId).length
  if (eventIdLength > 128) {
    return { ok: false, reason: 'event_id', event_id: eventId }
  }

  // language validation: canonical or legacy alias
  if (candidate.lang !== undefined && candidate.lang !== null) {
    const normalized = normalizePetLanguage(candidate.lang)
    if (!normalized) {
      return { ok: false, reason: 'lang', event_id: eventId }
    }
  }

  // voiceName validation: optional string <= 256 chars
  if (candidate.voiceName !== undefined) {
    if (typeof candidate.voiceName !== 'string') {
      return { ok: false, reason: 'voiceName', event_id: eventId }
    }
    if (Array.from(candidate.voiceName.trim()).length > 256) {
      return { ok: false, reason: 'voiceName', event_id: eventId }
    }
  }

  // debug validation: optional boolean
  if (candidate.debug !== undefined && typeof candidate.debug !== 'boolean') {
    return { ok: false, reason: 'debug', event_id: eventId }
  }

  return { ok: true, payload: candidate as unknown as PetSpeakPayload }
}

export function isValidPetSpeakPayload(event: unknown): event is PetSpeakPayload {
  return inspectPetSpeakPayload(event).ok
}
