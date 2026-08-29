import * as Notifications from 'expo-notifications'
import * as Speech from 'expo-speech'
import { Platform } from 'react-native'
import { normalizePetLanguage } from './pet-language-normalizer'

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
 * Resolves target locale for pet speech within the requested canonical language.
 * Resolution order:
 * - yue-HK: exact yue-HK, then exact zh-HK. Never zh-CN, zh-TW, or en.
 * - zh-CN: exact zh-CN only. Never zh-TW / zh-HK / yue / en.
 * - zh-TW: exact zh-TW only. Never zh-CN / zh-HK / yue / en.
 * - en-US: exact en-US, then another installed locale whose language is en.
 * If no same-language match is available, fails closed (returns null).
 */
export function resolvePetLocale(
  lang: string | undefined,
  availableLocales: string[]
): string | null {
  const canonical = normalizePetLanguage(lang ?? 'yue')
  if (!canonical) {
    return null
  }

  const localeLowerMap = new Map<string, string>()
  for (const loc of availableLocales) {
    if (typeof loc === 'string') {
      const trimmed = loc.trim()
      if (trimmed.length > 0) {
        localeLowerMap.set(trimmed.toLowerCase(), trimmed)
      }
    }
  }

  switch (canonical) {
    case 'yue-HK': {
      if (localeLowerMap.has('yue-hk')) {
        return localeLowerMap.get('yue-hk') ?? 'yue-HK'
      }
      if (localeLowerMap.has('zh-hk')) {
        return localeLowerMap.get('zh-hk') ?? 'zh-HK'
      }
      return null
    }
    case 'zh-CN': {
      if (localeLowerMap.has('zh-cn')) {
        return localeLowerMap.get('zh-cn') ?? 'zh-CN'
      }
      return null
    }
    case 'zh-TW': {
      if (localeLowerMap.has('zh-tw')) {
        return localeLowerMap.get('zh-tw') ?? 'zh-TW'
      }
      return null
    }
    case 'en-US': {
      if (localeLowerMap.has('en-us')) {
        return localeLowerMap.get('en-us') ?? 'en-US'
      }
      // Fallback: another installed locale whose language tag starts with 'en-' or is 'en'
      for (const loc of availableLocales) {
        if (typeof loc === 'string') {
          const lower = loc.trim().toLowerCase()
          if (lower === 'en' || lower.startsWith('en-') || lower.startsWith('en_')) {
            return loc.trim()
          }
        }
      }
      return null
    }
    default:
      return null
  }
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
