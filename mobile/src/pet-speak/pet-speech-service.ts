import { normalizePetLanguage, type CanonicalLanguage } from './pet-language-normalizer'
import { loadPetSpeechPreferences } from './pet-speech-preferences'
import {
  getPetSpeechNativeAdapter,
  type PetSpeechNativeAdapter,
  type PetSpeakTerminalOutcome
} from './pet-speak-adapters'
import { getExpoPetSpeechModule, type PetSpeechVoice } from './pet-speak-native-adapter'
import type { PetSpeakPayload } from './pet-speak-payload-validation'
import type { PreparedPetSpeakEventResult } from './pet-speak-types'

export type { PreparedPetSpeakEventResult }

export interface VoiceValidationResult {
  valid: boolean
  effectiveVoiceName?: string
  status: 'valid' | 'voice-unavailable'
}

/**
 * Enumerates all available TTS voices grouped/filtered for the 4 canonical languages.
 * Strips inferred gender or does not expose it to UI callers.
 */
export async function getAvailablePetSpeechVoices(): Promise<PetSpeechVoice[]> {
  const module = getExpoPetSpeechModule()
  if (!module) {
    return []
  }
  try {
    const rawVoices = await module.getAvailableVoicesAsync()
    if (!Array.isArray(rawVoices)) {
      return []
    }
    return rawVoices
  } catch {
    return []
  }
}

/**
 * Validates a persisted or requested voiceName for an utterance in a given canonical language.
 *
 * Rules:
 * 1. Find the persisted Voice.name in current engine's available voices.
 * 2. Verify its locale/language matches the requested semantic canonical language.
 * 3. If missing or mismatched:
 *    - Fall back to same-language default (or no voiceName override).
 *    - If no voice exists in the engine for that language, returns 'voice-unavailable'.
 * 4. NEVER use a voice from one language for another language.
 */
export function validatePetSpeechVoice(
  canonicalLang: CanonicalLanguage,
  persistedVoiceName: string | undefined,
  availableVoices: PetSpeechVoice[]
): VoiceValidationResult {
  const sameLangVoices = availableVoices.filter((v) => {
    if (v.language && v.language === canonicalLang) {
      return true
    }
    const langFromLocale = normalizePetLanguage(v.locale)
    return langFromLocale === canonicalLang
  })

  if (sameLangVoices.length === 0) {
    return {
      valid: false,
      effectiveVoiceName: undefined,
      status: 'voice-unavailable'
    }
  }

  if (persistedVoiceName && persistedVoiceName.trim().length > 0) {
    const trimmed = persistedVoiceName.trim()
    const match = sameLangVoices.find((v) => v.name === trimmed)
    if (match) {
      return {
        valid: true,
        effectiveVoiceName: match.name,
        status: 'valid'
      }
    }
    // Stale or cross-language ID: explicit invalid voice is unavailable.
    return {
      valid: false,
      effectiveVoiceName: undefined,
      status: 'voice-unavailable'
    }
  }

  return {
    valid: true,
    effectiveVoiceName: undefined,
    status: 'valid'
  }
}

/**
 * Resolves speech execution options (rate, voiceName) from local preferences
 * for an incoming pet.speak event while Enabled.
 */
export async function resolveEnabledSpeechOptions(
  event: PetSpeakPayload,
  availableVoices?: PetSpeechVoice[]
): Promise<{
  rate: number
  voiceName?: string
  isValidLocale: boolean
  canonicalLanguage?: CanonicalLanguage
}> {
  const prefs = await loadPetSpeechPreferences()
  const canonical = normalizePetLanguage(event.lang ?? 'yue-HK')

  if (!canonical) {
    return {
      rate: prefs.rate,
      voiceName: undefined,
      isValidLocale: false,
      canonicalLanguage: undefined
    }
  }

  const persistedVoice = prefs.voiceByLanguage[canonical]
  const voices = availableVoices ?? (await getAvailablePetSpeechVoices())

  const validation = validatePetSpeechVoice(canonical, persistedVoice, voices)

  return {
    rate: prefs.rate,
    voiceName: validation.effectiveVoiceName,
    isValidLocale: validation.status !== 'voice-unavailable',
    canonicalLanguage: canonical
  }
}

/**
 * Prepares an incoming live pet.speak event with mobile-local voice and rate preferences.
 * Preserves all original metadata and returns 'voice-unavailable' if locale cannot be resolved.
 */
export async function preparePetSpeakEvent(
  event: PetSpeakPayload,
  availableVoices?: PetSpeechVoice[]
): Promise<PreparedPetSpeakEventResult> {
  const resolved = await resolveEnabledSpeechOptions(event, availableVoices)
  if (!resolved.isValidLocale || !resolved.canonicalLanguage) {
    return { status: 'voice-unavailable' }
  }

  return {
    status: 'prepared',
    event: {
      ...event,
      lang: resolved.canonicalLanguage,
      rate: resolved.rate,
      voiceName: resolved.voiceName
    }
  }
}

/**
 * Executes a production-path Test Voice utterance.
 * Must use the exact same adapter / foreground / player / completion path as real pet.speak.
 * Only executes if Enabled.
 */
export async function executeTestVoiceAsync(
  lang: CanonicalLanguage,
  options?: {
    nativeAdapter?: PetSpeechNativeAdapter | null
    availableVoices?: PetSpeechVoice[]
  }
): Promise<{ outcome: PetSpeakTerminalOutcome }> {
  const prefs = await loadPetSpeechPreferences()
  if (!prefs.enabled) {
    return { outcome: 'voice-unavailable' }
  }

  const sampleTexts: Record<CanonicalLanguage, string> = {
    'yue-HK': '你好！我係你嘅桌面寵物。今日天氣幾好，我哋一齊處理 123 件事啦！',
    'zh-CN': '你好！我是你的桌面宠物。今天天气不错，我们一起处理 123 件事吧！',
    'zh-TW': '你好！我是你的桌面寵物。今天天氣不錯，我們一起處理 123 件事吧！',
    'en-US': 'Hello! I am your desktop pet. Let us handle 123 tasks together today!'
  }

  const text = sampleTexts[lang] ?? sampleTexts['yue-HK']
  const voices = options?.availableVoices ?? (await getAvailablePetSpeechVoices())
  const resolved = await resolveEnabledSpeechOptions(
    {
      type: 'pet.speak',
      text,
      lang,
      event_id: `test-${Date.now()}`
    },
    voices
  )

  if (!resolved.isValidLocale) {
    return { outcome: 'voice-unavailable' }
  }

  const adapter =
    options?.nativeAdapter !== undefined ? options.nativeAdapter : getPetSpeechNativeAdapter()

  if (!adapter) {
    return { outcome: 'playback-error' }
  }

  const eventPayload: PetSpeakPayload = {
    type: 'pet.speak',
    text,
    lang,
    event_id: `test-${Date.now()}`,
    rate: resolved.rate,
    voiceName: resolved.voiceName
  }

  const outcome = await adapter.speak(eventPayload)
  return { outcome }
}
