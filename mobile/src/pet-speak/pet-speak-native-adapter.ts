import { Platform } from 'react-native'
import type { PetSpeakPayload } from './pet-speak-payload-validation'
import { isValidPetSpeakPayload, parsePetSpeakRate } from './pet-speak-payload-validation'
import type { PetSpeakTerminalOutcome } from './pet-speak-adapters'
import { getExpoPetSpeechModule, type PetSpeechNativeModule } from '@orca/expo-pet-speech'

export interface PetSpeechNativeAdapter {
  speak(payload: PetSpeakPayload): Promise<PetSpeakTerminalOutcome>
  stop?(): Promise<void>
  acquireVoiceSession?(): Promise<{ held: boolean }>
  releaseVoiceSession?(): Promise<void>
}

export class AndroidPetSpeechAdapter implements PetSpeechNativeAdapter {
  private readonly nativeModule: PetSpeechNativeModule | null

  constructor(nativeModule?: PetSpeechNativeModule | null) {
    this.nativeModule = nativeModule ?? getExpoPetSpeechModule()
  }

  async speak(payload: PetSpeakPayload): Promise<PetSpeakTerminalOutcome> {
    if (!isValidPetSpeakPayload(payload)) {
      return 'playback-error'
    }

    if (!this.nativeModule) {
      return 'playback-error'
    }

    try {
      const result = await this.nativeModule.speakAsync({
        eventId: payload.event_id!,
        text: payload.text,
        lang: payload.lang,
        rate: parsePetSpeakRate(payload.rate)
      })
      return result.outcome
    } catch {
      // Surface ForegroundServiceStartNotAllowedException or any native call error as playback-error
      return 'playback-error'
    }
  }

  async stop(): Promise<void> {
    try {
      if (this.nativeModule) {
        await this.nativeModule.stopAsync()
      }
    } catch {
      // Ignore stop errors
    }
  }

  async acquireVoiceSession(): Promise<{ held: boolean }> {
    try {
      if (this.nativeModule?.acquireVoiceSessionAsync) {
        return await this.nativeModule.acquireVoiceSessionAsync()
      }
      return { held: false }
    } catch {
      return { held: false }
    }
  }

  async releaseVoiceSession(): Promise<void> {
    try {
      if (this.nativeModule?.releaseVoiceSessionAsync) {
        await this.nativeModule.releaseVoiceSessionAsync()
      }
    } catch {
      // Ignore release errors
    }
  }
}

export function getPetSpeechNativeAdapter(): PetSpeechNativeAdapter | null {
  if (Platform.OS === 'android') {
    return new AndroidPetSpeechAdapter()
  }
  return null
}
