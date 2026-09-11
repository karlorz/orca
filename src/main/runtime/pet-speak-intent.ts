import { randomUUID } from 'node:crypto'
import { normalizePetLanguage, type CanonicalLanguage } from './pet-language-normalizer'
import { parsePetSpeakRate } from './pet-speak-rate'
import { PET_SPEAK_MAX_TEXT_GRAPHEMES } from '../../shared/pet-speak-limits'

export type PetSpeakEvent = {
  type: 'pet.speak'
  text: string
  lang?: CanonicalLanguage
  event_id?: string
  original_text?: string
  rate: number
  voiceName?: string
  debug?: boolean
}

export type SpeakIntentDecision =
  | {
      ok: true
      event: PetSpeakEvent
      charsCount: number
    }
  | {
      ok: false
      reason: 'empty' | 'length' | 'malformed'
      event_id?: string
      charsCount: number
    }

export function parseSpeakIntentDecision(message: Record<string, unknown>): SpeakIntentDecision {
  const eventIdInMessage =
    typeof message.event_id === 'string' ? message.event_id.trim() : undefined
  const rawText = typeof message.text === 'string' ? message.text.trim() : ''
  const textChars = Array.from(rawText)

  if (textChars.length === 0) {
    return {
      ok: false,
      reason: 'empty',
      ...(eventIdInMessage ? { event_id: eventIdInMessage } : {}),
      charsCount: 0
    }
  }

  if (textChars.length > PET_SPEAK_MAX_TEXT_GRAPHEMES) {
    return {
      ok: false,
      reason: 'length',
      ...(eventIdInMessage ? { event_id: eventIdInMessage } : {}),
      charsCount: textChars.length
    }
  }

  let normalizedLang: CanonicalLanguage | undefined
  if (message.lang !== undefined && message.lang !== null) {
    normalizedLang = normalizePetLanguage(message.lang)
    if (!normalizedLang) {
      return {
        ok: false,
        reason: 'malformed',
        ...(eventIdInMessage ? { event_id: eventIdInMessage } : {}),
        charsCount: textChars.length
      }
    }
  }

  let eventId = typeof message.event_id === 'string' ? message.event_id.trim() : ''
  if (eventId) {
    if (Array.from(eventId).length > 128) {
      return {
        ok: false,
        reason: 'malformed',
        ...(eventIdInMessage ? { event_id: eventIdInMessage } : {}),
        charsCount: textChars.length
      }
    }
  } else {
    eventId = `relay-${randomUUID()}`
  }

  let voiceName: string | undefined
  if (typeof message.voiceName === 'string') {
    const trimmedVoiceName = message.voiceName.trim()
    if (Array.from(trimmedVoiceName).length <= 256) {
      voiceName = trimmedVoiceName
    }
  } else if (typeof message.voice_name === 'string') {
    const trimmedVoiceName = message.voice_name.trim()
    if (Array.from(trimmedVoiceName).length <= 256) {
      voiceName = trimmedVoiceName
    }
  }

  const debug = typeof message.debug === 'boolean' ? message.debug : undefined

  let originalText: string | undefined
  if (typeof message.original_text === 'string') {
    const trimmedOriginalText = message.original_text.trim()
    const originalTextChars = Array.from(trimmedOriginalText)
    if (originalTextChars.length > 0 && originalTextChars.length <= 240) {
      originalText = trimmedOriginalText
    }
  }

  return {
    ok: true,
    charsCount: textChars.length,
    event: {
      type: 'pet.speak',
      text: rawText,
      ...(normalizedLang ? { lang: normalizedLang } : {}),
      event_id: eventId,
      ...(originalText ? { original_text: originalText } : {}),
      rate: parsePetSpeakRate(message.rate),
      ...(voiceName ? { voiceName } : {}),
      ...(debug !== undefined ? { debug } : {})
    }
  }
}

export function parseSpeakIntentMessage(
  message: Record<string, unknown>
): { event: PetSpeakEvent; charsCount: number } | null {
  const decision = parseSpeakIntentDecision(message)
  if (!decision.ok) {
    return null
  }
  return {
    event: decision.event,
    charsCount: decision.charsCount
  }
}
