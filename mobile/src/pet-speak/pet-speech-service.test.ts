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

vi.mock('./pet-speak-native-adapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./pet-speak-native-adapter')>()
  return {
    ...actual,
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
  preparePetSpeakEvent,
  executeTestVoiceAsync
} from './pet-speech-service'
import {
  applyPetSpeakLiveCaption,
  subscribePetSpeakLiveCaption
} from './pet-speak-live-caption'
import type { PetSpeakCaption } from './pet-speak-types'
import {
  setPetSpeechEnabled,
  setPetSpeechVoiceForLanguage,
  setPetSpeechRate
} from './pet-speech-preferences'
import {
  AndroidPetSpeechAdapter,
  type PetSpeechVoice,
  type PetSpeechNativeModule
} from './pet-speak-native-adapter'
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

  it('detects missing/stale voice and reports voice-unavailable', () => {
    const res = validatePetSpeechVoice('yue-HK', 'stale-vanished-voice', sampleVoices)
    expect(res.valid).toBe(false)
    expect(res.effectiveVoiceName).toBeUndefined()
    expect(res.status).toBe('voice-unavailable')
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
    expect(options.canonicalLanguage).toBe('yue-HK')
  })

  it('returns undefined canonicalLanguage and isValidLocale false when event has invalid locale', async () => {
    await setPetSpeechEnabled(true)
    const options = await resolveEnabledSpeechOptions(
      {
        type: 'pet.speak',
        text: 'unknown lang test',
        lang: 'invalid-locale-xyz',
        event_id: 'ev-invalid-1'
      },
      sampleVoices
    )

    expect(options.isValidLocale).toBe(false)
    expect(options.canonicalLanguage).toBeUndefined()
    expect(options.voiceName).toBeUndefined()
  })

  describe('preparePetSpeakEvent', () => {
    it('prepares live yue event with persisted voice and rate while preserving all other metadata', async () => {
      await setPetSpeechEnabled(true)
      await setPetSpeechRate(1.4)
      await setPetSpeechVoiceForLanguage('yue-HK', 'yue-HK-voice-1')

      const rawEvent: PetSpeakPayload = {
        type: 'pet.speak',
        text: ' 你好！ ',
        lang: 'yue',
        event_id: ' ev-live-1 ',
        seq: 42,
        epoch: 'epoch-abc',
        replayed: false,
        playerKind: 'media3',
        debug: true
      }

      const result = await preparePetSpeakEvent(rawEvent, sampleVoices)
      expect(result.status).toBe('prepared')
      if (result.status === 'prepared') {
        expect(result.event).toEqual({
          type: 'pet.speak',
          text: ' 你好！ ',
          lang: 'yue-HK',
          event_id: ' ev-live-1 ',
          seq: 42,
          epoch: 'epoch-abc',
          replayed: false,
          playerKind: 'media3',
          debug: true,
          rate: 1.4,
          voiceName: 'yue-HK-voice-1'
        })
      }
    })

    it('returns voice-unavailable status when language has no available voice in engine', async () => {
      await setPetSpeechEnabled(true)
      const rawEvent: PetSpeakPayload = {
        type: 'pet.speak',
        text: '你好',
        lang: 'zh-TW',
        event_id: 'ev-no-voice-1'
      }

      const result = await preparePetSpeakEvent(rawEvent, sampleVoices)
      expect(result.status).toBe('voice-unavailable')
    })

    it('returns voice-unavailable status when an invalid or stale explicit voice is persisted despite same-language voices existing', async () => {
      await setPetSpeechEnabled(true)
      await setPetSpeechVoiceForLanguage('yue-HK', 'stale-vanished-voice')

      const rawEvent: PetSpeakPayload = {
        type: 'pet.speak',
        text: '你好',
        lang: 'yue-HK',
        event_id: 'ev-stale-voice-1'
      }

      const result = await preparePetSpeakEvent(rawEvent, sampleVoices)
      expect(result.status).toBe('voice-unavailable')
    })

    it('returns voice-unavailable status when a wrong-language explicit voice is persisted', async () => {
      await setPetSpeechEnabled(true)
      await setPetSpeechVoiceForLanguage('yue-HK', 'zh-CN-voice-1')

      const rawEvent: PetSpeakPayload = {
        type: 'pet.speak',
        text: '你好',
        lang: 'yue-HK',
        event_id: 'ev-cross-voice-1'
      }

      const result = await preparePetSpeakEvent(rawEvent, sampleVoices)
      expect(result.status).toBe('voice-unavailable')
    })

    it('permits preparation with undefined voiceName when no explicit voice is selected and same-language voices exist', async () => {
      await setPetSpeechEnabled(true)
      // no voice selection for yue-HK

      const rawEvent: PetSpeakPayload = {
        type: 'pet.speak',
        text: '你好',
        lang: 'yue-HK',
        event_id: 'ev-no-explicit-voice-1'
      }

      const result = await preparePetSpeakEvent(rawEvent, sampleVoices)
      expect(result.status).toBe('prepared')
      if (result.status === 'prepared') {
        expect(result.event.voiceName).toBeUndefined()
        expect(result.event.lang).toBe('yue-HK')
      }
    })
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

  it('executeTestVoiceAsync uses longer language-specific multi-clause samples for prosody/timbre evaluation', async () => {
    await setPetSpeechEnabled(true)
    await setPetSpeechRate(1)
    await setPetSpeechVoiceForLanguage('yue-HK', 'yue-HK-voice-1')

    const mockSpokenPayloads: PetSpeakPayload[] = []
    const mockAdapter: PetSpeechNativeAdapter = {
      speak: async (payload) => {
        mockSpokenPayloads.push(payload)
        return 'spoken'
      }
    }

    await executeTestVoiceAsync('yue-HK', {
      nativeAdapter: mockAdapter,
      availableVoices: sampleVoices
    })

    expect(mockSpokenPayloads[0].text).toBe(
      '你好！我係你嘅桌面寵物。今日天氣幾好，我哋一齊處理 123 件事啦！'
    )

    // zh-CN sample check
    await executeTestVoiceAsync('zh-CN', {
      nativeAdapter: mockAdapter,
      availableVoices: sampleVoices
    })
    expect(mockSpokenPayloads[1].text).toBe(
      '你好！我是你的桌面宠物。今天天气不错，我们一起处理 123 件事吧！'
    )

    // zh-TW sample check
    await executeTestVoiceAsync('zh-TW', {
      nativeAdapter: mockAdapter,
      availableVoices: [
        ...sampleVoices,
        {
          name: 'zh-TW-voice-1',
          locale: 'zh-TW',
          language: 'zh-TW',
          quality: 300,
          network: false,
          gender: 'unknown'
        }
      ]
    })
    expect(mockSpokenPayloads[2].text).toBe(
      '你好！我是你的桌面寵物。今天天氣不錯，我們一起處理 123 件事吧！'
    )

    // en-US sample check
    await executeTestVoiceAsync('en-US', {
      nativeAdapter: mockAdapter,
      availableVoices: sampleVoices
    })
    expect(mockSpokenPayloads[3].text).toBe(
      'Hello! I am your desktop pet. Let us handle 123 tasks together today!'
    )
  })

  it('executeTestVoiceAsync for en-US delivers valid payload through AndroidPetSpeechAdapter to native speakAsync', async () => {
    await setPetSpeechEnabled(true)
    await setPetSpeechVoiceForLanguage('en-US', 'en-US-voice-1')

    const nativeCalls: Array<{
      eventId: string
      text: string
      lang?: string
      rate: number
      voiceName?: string
    }> = []

    const mockNativeModule: PetSpeechNativeModule = {
      speakAsync: vi.fn(async (params) => {
        nativeCalls.push(params)
        return { outcome: 'spoken' as const }
      }),
      stopAsync: vi.fn(async () => {}),
      getAvailableVoicesAsync: vi.fn(async () => []),
      acquireVoiceSessionAsync: vi.fn(async () => ({ held: true })),
      releaseVoiceSessionAsync: vi.fn(async () => {}),
      updateVoiceSessionNotificationAsync: vi.fn(async () => {})
    }

    const adapter = new AndroidPetSpeechAdapter(mockNativeModule)
    const res = await executeTestVoiceAsync('en-US', {
      nativeAdapter: adapter,
      availableVoices: sampleVoices
    })

    expect(res.outcome).toBe('spoken')
    expect(nativeCalls.length).toBe(1)
    expect(nativeCalls[0].lang).toBe('en-US')
    expect(nativeCalls[0].text).toBe(
      'Hello! I am your desktop pet. Let us handle 123 tasks together today!'
    )
  })

  it('executeTestVoiceAsync publishes a live caption with the same event_id as speak, including originalText, then clears', async () => {
    await setPetSpeechEnabled(true)
    await setPetSpeechVoiceForLanguage('yue-HK', 'yue-HK-voice-1')

    applyPetSpeakLiveCaption(null)
    const captions: Array<PetSpeakCaption | null> = []
    const unsub = subscribePetSpeakLiveCaption((c) => {
      captions.push(c)
    })

    const spoken: PetSpeakPayload[] = []
    const mockAdapter: PetSpeechNativeAdapter = {
      speak: async (payload) => {
        spoken.push(payload)
        return 'spoken'
      }
    }

    try {
      await executeTestVoiceAsync('yue-HK', {
        nativeAdapter: mockAdapter,
        availableVoices: sampleVoices
      })

      expect(spoken.length).toBe(1)
      expect(spoken[0].event_id).toBeTruthy()
      expect(spoken[0].original_text).toContain('Hello! I am your desktop pet')
      expect(captions.length).toBeGreaterThanOrEqual(2)
      expect(captions[0]?.eventId).toBe(spoken[0].event_id)
      expect(captions[0]?.text).toContain('桌面寵物')
      expect(captions[0]?.originalText).toContain('Hello! I am your desktop pet')
      expect(captions[captions.length - 1]).toBeNull()
    } finally {
      unsub()
      applyPetSpeakLiveCaption(null)
    }
  })
})
