import * as Notifications from 'expo-notifications'
import * as Speech from 'expo-speech'
import { Platform } from 'react-native'
import { ALLOWED_LANGUAGES } from './pet-speak-payload-validation'

export type { PetSpeakPayload, PetSpeakSubscribeResult } from './pet-speak-types'

export type PetSpeakTerminalOutcome =
  | 'spoken'
  | 'voice-unavailable'
  | 'playback-error'
  | 'cancelled'

export interface TtsAdapter {
  getAvailableVoices(): Promise<string[]>
  speak(text: string, locale: string): Promise<void>
  stop?(): Promise<void>
}

export interface MediaSessionAdapter {
  startSession(text: string): Promise<string>
  stopSession(sessionId: string): Promise<void>
}

export {
  type PetSpeechNativeAdapter,
  AndroidPetSpeechAdapter,
  getPetSpeechNativeAdapter
} from './pet-speak-native-adapter'

/**
 * Resolve target locale for pet speech strictly to Cantonese.
 * Order: yue-HK then zh-HK.
 * Never English, never zh-CN, never zh-TW.
 * If neither is available or requested lang is not Cantonese, fails closed (returns null).
 */
export function resolvePetLocale(
  lang: string | undefined,
  availableLocales: string[]
): string | null {
  const normalizedLang = (lang ?? 'yue').toLowerCase().trim()
  if (!ALLOWED_LANGUAGES.has(normalizedLang)) {
    return null
  }
  const set = new Set(availableLocales.map((l) => l.toLowerCase()))
  if (set.has('yue-hk')) {
    return 'yue-HK'
  }
  if (set.has('zh-hk')) {
    return 'zh-HK'
  }
  return null
}

export class DefaultExpoNotificationMediaSessionAdapter implements MediaSessionAdapter {
  private channelConfigured = false

  private async ensureChannel(): Promise<void> {
    if (!this.channelConfigured && Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('orca-pet-speech', {
        name: 'Pet Speech Media Session',
        importance: Notifications.AndroidImportance.HIGH,
        sound: undefined,
        vibrationPattern: undefined
      })
      this.channelConfigured = true
    }
  }

  async startSession(text: string): Promise<string> {
    await this.ensureChannel()
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Orca Pet',
        body: text,
        ...(Platform.OS === 'android' ? { channelId: 'orca-pet-speech' } : {})
      },
      trigger: null
    })
    return id
  }

  async stopSession(sessionId: string): Promise<void> {
    if (sessionId) {
      await Notifications.dismissNotificationAsync(sessionId).catch(() => {})
    }
  }
}

export class DefaultTtsAdapter implements TtsAdapter {
  async getAvailableVoices(): Promise<string[]> {
    try {
      const voices = await Speech.getAvailableVoicesAsync()
      if (!Array.isArray(voices)) {
        return []
      }
      return voices
        .map((v) => v.language)
        .filter((lang): lang is string => typeof lang === 'string' && lang.length > 0)
    } catch {
      return []
    }
  }

  async speak(text: string, locale: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      try {
        Speech.speak(text, {
          language: locale,
          onDone: () => resolve(),
          onStopped: () => resolve(),
          onError: (error) => reject(error instanceof Error ? error : new Error(String(error)))
        })
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  }

  async stop(): Promise<void> {
    try {
      await Speech.stop()
    } catch {
      // Ignore stop errors
    }
  }
}
