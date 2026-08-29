import { loadPetSpeechPreferences, type PetSpeechPreferences } from './pet-speech-preferences'
import { getAvailablePetSpeechVoices } from './pet-speech-service'
import { getFriendlyDeviceModelName } from './pet-speech-device-identity'
import type { CanonicalLanguage } from './pet-language-normalizer'

export type PetSpeechAvailability = 'available' | 'disabled' | 'unavailable'

export interface PetSpeechDeviceStatusPayload {
  installUuid: string
  modelName: string
  enabled: boolean
  availability: PetSpeechAvailability
  activeEngine?: string
  supportedLanguages?: CanonicalLanguage[]
  currentLanguage?: CanonicalLanguage
  selectedVoice?: string
  rate?: number
  lastOutcome?: string
  updatedAt?: number
}

/**
 * Builds the current Pet Speech device status payload for RPC reporting.
 *
 * Rules:
 * - When Pet Speech is disabled, reports minimal bounded identity (installUuid, modelName, enabled: false, availability: 'disabled').
 * - When enabled, gathers active engine, available supported languages, selected matching voice, and device rate.
 */
export async function buildPetSpeechDeviceStatus(options?: {
  currentLanguage?: CanonicalLanguage
  lastOutcome?: string
  preferences?: PetSpeechPreferences
}): Promise<PetSpeechDeviceStatusPayload> {
  const prefs = options?.preferences ?? (await loadPetSpeechPreferences())
  const modelName = getFriendlyDeviceModelName()

  if (!prefs.enabled) {
    return {
      installUuid: prefs.installUuid,
      modelName,
      enabled: false,
      availability: 'disabled'
    }
  }

  const voices = await getAvailablePetSpeechVoices()
  const activeEngine = voices[0]?.engine ?? undefined

  const supportedLanguagesSet = new Set<CanonicalLanguage>()
  for (const voice of voices) {
    if (voice.language) {
      supportedLanguagesSet.add(voice.language as CanonicalLanguage)
    }
  }
  const supportedLanguages = Array.from(supportedLanguagesSet)

  const currentLang = options?.currentLanguage ?? 'yue-HK'
  const selectedVoice = prefs.voiceByLanguage[currentLang] ?? undefined

  const availability: PetSpeechAvailability = voices.length > 0 ? 'available' : 'unavailable'

  return {
    installUuid: prefs.installUuid,
    modelName,
    enabled: true,
    availability,
    ...(activeEngine ? { activeEngine } : {}),
    ...(supportedLanguages.length > 0 ? { supportedLanguages } : {}),
    currentLanguage: currentLang,
    ...(selectedVoice ? { selectedVoice } : {}),
    rate: prefs.rate,
    ...(options?.lastOutcome ? { lastOutcome: options.lastOutcome } : {}),
    updatedAt: Date.now()
  }
}
