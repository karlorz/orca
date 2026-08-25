export type { PetSpeakPayload, PetSpeakSubscribeResult } from './pet-speak-types'
import type { PetSpeakPayload } from './pet-speak-types'

export const ALLOWED_LANGUAGES = new Set(['yue', 'cantonese', 'yue-hk', 'zh-hk'])

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

  // language validation: default or Cantonese
  if (candidate.lang !== undefined) {
    if (typeof candidate.lang !== 'string') {
      return false
    }
    const langNormalized = candidate.lang.toLowerCase().trim()
    if (!ALLOWED_LANGUAGES.has(langNormalized)) {
      return false
    }
  }

  return true
}
