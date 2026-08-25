import { Platform } from 'react-native'

export interface PetSpeechUtteranceOptions {
  eventId: string
  text: string
  lang?: string
  rate?: number
}

export interface PetSpeechResult {
  outcome: 'spoken' | 'voice-unavailable' | 'playback-error' | 'cancelled'
}

export interface PetSpeechNativeModule {
  getAvailableVoicesAsync(): Promise<string[]>
  speakAsync(options: PetSpeechUtteranceOptions): Promise<PetSpeechResult>
  stopAsync(): Promise<void>
  acquireVoiceSessionAsync(): Promise<{ held: boolean }>
  releaseVoiceSessionAsync(): Promise<void>
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
