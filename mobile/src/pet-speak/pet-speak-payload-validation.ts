export type { PetSpeakPayload, PetSpeakSubscribeResult } from './pet-speak-types'
import type { PetSpeakPayload } from './pet-speak-types'
import { normalizePetLanguage } from './pet-language-normalizer'

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

export function isValidPetSpeakPayload(event: unknown): event is PetSpeakPayload {
  if (!event || typeof event !== 'object') {
    return false
  }
  const candidate = event as Record<string, unknown>
  if (candidate.type !== 'pet.speak') {
    return false
  }
  if (typeof candidate.text !== 'string') {
    return false
  }
  const trimmed = candidate.text.trim()
  const textLength = Array.from(trimmed).length
  if (textLength === 0 || textLength > 70) {
    return false
  }

  // event_id must be non-empty string <= 128 Unicode characters
  if (typeof candidate.event_id !== 'string') {
    return false
  }
  const eventId = candidate.event_id.trim()
  const eventIdLength = Array.from(eventId).length
  if (eventIdLength === 0 || eventIdLength > 128) {
    return false
  }

  // language validation: canonical or legacy alias
  if (candidate.lang !== undefined && candidate.lang !== null) {
    const normalized = normalizePetLanguage(candidate.lang)
    if (!normalized) {
      return false
    }
  }

  // voiceName validation: optional string <= 256 chars
  if (candidate.voiceName !== undefined) {
    if (typeof candidate.voiceName !== 'string') {
      return false
    }
    if (Array.from(candidate.voiceName.trim()).length > 256) {
      return false
    }
  }

  // debug validation: optional boolean
  if (candidate.debug !== undefined && typeof candidate.debug !== 'boolean') {
    return false
  }

  return true
}
