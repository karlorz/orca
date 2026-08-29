import { Platform } from 'react-native'

export interface PetSpeechUtteranceOptions {
  eventId: string
  text: string
  lang?: string
  rate?: number
  voiceName?: string
  playerKind?: 'mediaplayer' | 'media3'
  debug?: boolean
}

export interface PetSpeechVoice {
  name: string
  locale: string
  language?: string
  quality: number
  network: boolean
  engine?: string
  gender: string
}

export interface PetSpeechResult {
  outcome: 'spoken' | 'voice-unavailable' | 'playback-error' | 'cancelled'
}

export interface PetSpeechNativeModule {
  getAvailableVoicesAsync(): Promise<PetSpeechVoice[]>
  speakAsync(options: PetSpeechUtteranceOptions): Promise<PetSpeechResult>
  stopAsync(): Promise<void>
  acquireVoiceSessionAsync(): Promise<{ held: boolean }>
  releaseVoiceSessionAsync(): Promise<void>
  updateVoiceSessionNotificationAsync?(text: string): Promise<void>
}

let nativeModule: PetSpeechNativeModule | null = null

export function getExpoPetSpeechModule(): PetSpeechNativeModule | null {
  if (Platform.OS !== 'android') {
    return null
  }
  if (!nativeModule) {
    try {
      // Lazy load expo-modules-core only on Android runtime
      const { requireNativeModule } = require('expo-modules-core') as {
        requireNativeModule: (moduleName: string) => PetSpeechNativeModule
      }
      nativeModule = requireNativeModule('ExpoPetSpeech')
    } catch {
      nativeModule = null
    }
  }
  return nativeModule
}

export default getExpoPetSpeechModule
