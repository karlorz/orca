import { randomUUID } from 'node:crypto'
import { normalizePetLanguage, type CanonicalLanguage } from './pet-language-normalizer'
import { parsePetSpeakRate } from './pet-speak-rate'

export type PetSpeakEvent = {
  type: 'pet.speak'
  text: string
  lang?: CanonicalLanguage
  event_id?: string
  rate: number
  voiceName?: string
  debug?: boolean
}

export function parseSpeakIntentMessage(
  message: Record<string, unknown>
): { event: PetSpeakEvent; charsCount: number } | null {
  const rawText = typeof message.text === 'string' ? message.text.trim() : ''
  const textChars = Array.from(rawText)
  if (textChars.length === 0 || textChars.length > 70) {
    return null
  }

  let normalizedLang: CanonicalLanguage | undefined
  if (message.lang !== undefined && message.lang !== null) {
    normalizedLang = normalizePetLanguage(message.lang)
    if (!normalizedLang) {
      return null
    }
  }

  let eventId = typeof message.event_id === 'string' ? message.event_id.trim() : ''
  if (eventId) {
    if (Array.from(eventId).length > 128) {
      return null
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
  return {
    charsCount: textChars.length,
    event: {
      type: 'pet.speak',
      text: rawText,
      ...(normalizedLang ? { lang: normalizedLang } : {}),
      event_id: eventId,
      rate: parsePetSpeakRate(message.rate),
      ...(voiceName ? { voiceName } : {}),
      ...(debug !== undefined ? { debug } : {})
    }
  }
}
