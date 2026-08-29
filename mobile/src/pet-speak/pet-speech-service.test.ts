import { beforeEach, describe, expect, it, vi } from 'vitest'
import AsyncStorage from '@react-native-async-storage/async-storage'

vi.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 'high' },
  setNotificationChannelAsync: vi.fn(),
  getPermissionsAsync: vi.fn(),
  requestPermissionsAsync: vi.fn(),
  scheduleNotificationAsync: vi.fn(),
  dismissNotificationAsync: vi.fn()
}))

vi.mock('expo-speech', () => ({
  VoiceQuality: { Default: 'Default', Enhanced: 'Enhanced' },
  getAvailableVoicesAsync: vi.fn(async () => []),
  speak: vi.fn(),
  stop: vi.fn(async () => {})
}))

vi.mock('react-native', () => ({
  Platform: { OS: 'android', Version: 34 }
}))

vi.mock('./pet-speak-native-adapter', async () => {
  return {
    getExpoPetSpeechModule: vi.fn(() => null),
    getPetSpeechNativeAdapter: vi.fn(() => null)
  }
})

vi.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>()
  return {
    default: {
      getItem: vi.fn(async (key: string) => store.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => {
        store.set(key, value)
      }),
      removeItem: vi.fn(async (key: string) => {
        store.delete(key)
      }),
      getAllKeys: vi.fn(async () => Array.from(store.keys())),
      clear: vi.fn(async () => {
        store.clear()
      })
    }
  }
})

import {
  validatePetSpeechVoice,
  resolveEnabledSpeechOptions,
  executeTestVoiceAsync
} from './pet-speech-service'
import {
  setPetSpeechEnabled,
  setPetSpeechVoiceForLanguage,
  setPetSpeechRate
} from './pet-speech-preferences'
import type { PetSpeechVoice } from './pet-speak-native-adapter'
import type { PetSpeechNativeAdapter } from './pet-speak-adapters'
import type { PetSpeakPayload } from './pet-speak-payload-validation'

describe('PetSpeechService - Voice validation and Test Voice', () => {
  const sampleVoices: PetSpeechVoice[] = [
    {
      name: 'yue-HK-voice-1',
      locale: 'yue-HK',
      language: 'yue-HK',
      quality: 300,
      network: false,
      gender: 'unknown'
    },
    {
      name: 'zh-CN-voice-1',
      locale: 'zh-CN',
      language: 'zh-CN',
      quality: 300,
      network: true,
      gender: 'unknown'
    },
    {
      name: 'en-US-voice-1',
      locale: 'en-US',
      language: 'en-US',
      quality: 400,
      network: false,
      gender: 'unknown'
    }
  ]

  beforeEach(async () => {
    await AsyncStorage.clear()
  })

  it('validates persisted voice that exists for target language', () => {
    const res = validatePetSpeechVoice('yue-HK', 'yue-HK-voice-1', sampleVoices)
    expect(res.valid).toBe(true)
    expect(res.effectiveVoiceName).toBe('yue-HK-voice-1')
    expect(res.status).toBe('valid')
  })

  it('detects missing/stale voice and falls back to same-language default', () => {
    const res = validatePetSpeechVoice('yue-HK', 'stale-vanished-voice', sampleVoices)
    expect(res.valid).toBe(false)
    expect(res.effectiveVoiceName).toBeUndefined()
    expect(res.status).toBe('fallback-default')
  })

  it('never uses a voice from another language family', () => {
    // Attempting to use zh-CN voice for yue-HK language
    const res = validatePetSpeechVoice('yue-HK', 'zh-CN-voice-1', sampleVoices)
    expect(res.valid).toBe(false)
    expect(res.effectiveVoiceName).toBeUndefined()
  })

  it('returns voice-unavailable when no same-language voice is installed', () => {
    const res = validatePetSpeechVoice('zh-TW', undefined, sampleVoices)
    expect(res.valid).toBe(false)
    expect(res.status).toBe('voice-unavailable')
    expect(res.effectiveVoiceName).toBeUndefined()
  })

  it('resolves enabled speech options applying local rate and validated voice', async () => {
    await setPetSpeechEnabled(true)
    await setPetSpeechRate(1.8)
    await setPetSpeechVoiceForLanguage('yue-HK', 'yue-HK-voice-1')

    const options = await resolveEnabledSpeechOptions(
      {
        type: 'pet.speak',
        text: '測試',
        lang: 'yue-HK',
        event_id: 'ev-1'
      },
      sampleVoices
    )

    expect(options.rate).toBe(1.8)
    expect(options.voiceName).toBe('yue-HK-voice-1')
    expect(options.isValidLocale).toBe(true)
  })

  it('executeTestVoiceAsync fails closed when disabled', async () => {
    await setPetSpeechEnabled(false)
    const res = await executeTestVoiceAsync('yue-HK')
    expect(res.outcome).toBe('voice-unavailable')
  })

  it('executeTestVoiceAsync reaches production adapter path when enabled', async () => {
    await setPetSpeechEnabled(true)
    await setPetSpeechRate(1.2)
    await setPetSpeechVoiceForLanguage('en-US', 'en-US-voice-1')

    const mockSpokenPayloads: PetSpeakPayload[] = []
    const mockAdapter: PetSpeechNativeAdapter = {
      speak: async (payload) => {
        mockSpokenPayloads.push(payload)
        return 'spoken'
      }
    }

    const res = await executeTestVoiceAsync('en-US', {
      nativeAdapter: mockAdapter,
      availableVoices: sampleVoices
    })

    expect(res.outcome).toBe('spoken')
    expect(mockSpokenPayloads.length).toBe(1)
    expect(mockSpokenPayloads[0].rate).toBe(1.2)
    expect(mockSpokenPayloads[0].voiceName).toBe('en-US-voice-1')
    expect(mockSpokenPayloads[0].lang).toBe('en-US')
  })
})
