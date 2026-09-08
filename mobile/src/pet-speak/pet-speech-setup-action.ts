import { normalizePetLanguage, type CanonicalLanguage } from './pet-language-normalizer'

type PetSpeechVoiceLike = {
  language?: string
  locale?: string
}

export const GOOGLE_TTS_MARKET_URL = 'market://details?id=com.google.android.tts'
export const GOOGLE_TTS_HTTPS_URL =
  'https://play.google.com/store/apps/details?id=com.google.android.tts'
export const TTS_SETTINGS_ACTION = 'com.android.settings.TTS_SETTINGS'

export type PetSpeechSetupAction =
  | { kind: 'none' }
  | {
      kind: 'install-engine'
      marketUrl: string
      httpsUrl: string
    }
  | {
      kind: 'open-tts-settings'
      action: string
    }

export interface ResolvePetSpeechSetupActionParams {
  platform: string
  matchingVoiceCount: number
  catalogVoiceCount: number
}

export function resolvePetSpeechSetupAction({
  platform,
  matchingVoiceCount,
  catalogVoiceCount
}: ResolvePetSpeechSetupActionParams): PetSpeechSetupAction {
  if (platform !== 'android') {
    return { kind: 'none' }
  }

  if (catalogVoiceCount === 0 && matchingVoiceCount === 0) {
    return {
      kind: 'install-engine',
      marketUrl: GOOGLE_TTS_MARKET_URL,
      httpsUrl: GOOGLE_TTS_HTTPS_URL
    }
  }

  if (catalogVoiceCount > 0 && matchingVoiceCount === 0) {
    return {
      kind: 'open-tts-settings',
      action: TTS_SETTINGS_ACTION
    }
  }

  return { kind: 'none' }
}

export function petSpeechVoiceMatchesLanguage(
  voice: PetSpeechVoiceLike,
  canonicalLang: CanonicalLanguage
): boolean {
  if (voice.language && voice.language === canonicalLang) {
    return true
  }
  const langFromLocale = normalizePetLanguage(voice.locale)
  return langFromLocale === canonicalLang
}

export function countMatchingPetSpeechVoices(
  voices: PetSpeechVoiceLike[],
  canonicalLang: CanonicalLanguage
): number {
  let count = 0
  for (const v of voices) {
    if (petSpeechVoiceMatchesLanguage(v, canonicalLang)) {
      count++
    }
  }
  return count
}

export interface PetSpeechSetupLinking {
  openURL(url: string): Promise<unknown>
  sendIntent?: (
    action: string,
    extras?: Array<{ key: string; value: string | number | boolean }>
  ) => Promise<unknown>
}

export interface PetSpeechSetupOpenResult {
  opened: 'market' | 'https' | 'tts-settings' | 'none'
}

export async function openPetSpeechSetupAction(
  action: PetSpeechSetupAction,
  linking: PetSpeechSetupLinking
): Promise<PetSpeechSetupOpenResult> {
  if (action.kind === 'none') {
    return { opened: 'none' }
  }

  const openInstallEngineUrls = async (): Promise<PetSpeechSetupOpenResult> => {
    try {
      await linking.openURL(GOOGLE_TTS_MARKET_URL)
      return { opened: 'market' }
    } catch {
      await linking.openURL(GOOGLE_TTS_HTTPS_URL)
      return { opened: 'https' }
    }
  }

  if (action.kind === 'install-engine') {
    return await openInstallEngineUrls()
  }

  if (action.kind === 'open-tts-settings') {
    if (typeof linking.sendIntent === 'function') {
      try {
        await linking.sendIntent(action.action)
        return { opened: 'tts-settings' }
      } catch {
        // Fall back to install-engine URL chain.
      }
    }
    return await openInstallEngineUrls()
  }

  return { opened: 'none' }
}
