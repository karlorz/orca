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

import { describe, expect, it, vi, beforeEach } from 'vitest'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { buildPetSpeechDeviceStatus } from './pet-speech-device-status'
import {
  loadPetSpeechPreferences,
  setPetSpeechEnabled,
  setPetSpeechRate,
  setPetSpeechVoiceForLanguage
} from './pet-speech-preferences'

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

vi.mock('react-native', () => ({
  Platform: {
    OS: 'android',
    constants: { Model: 'iPlay_40' }
  }
}))

vi.mock('./pet-speak-native-adapter', () => ({
  getExpoPetSpeechModule: vi.fn(() => ({
    getAvailableVoicesAsync: vi.fn().mockResolvedValue([
      {
        name: 'cmn-hk-x-f-local',
        locale: 'yue-HK',
        language: 'yue-HK',
        quality: 400,
        network: false,
        engine: 'com.google.android.tts',
        gender: 'female'
      },
      {
        name: 'en-us-x-sfg-local',
        locale: 'en-US',
        language: 'en-US',
        quality: 400,
        network: false,
        engine: 'com.google.android.tts',
        gender: 'female'
      }
    ]),
    speakAsync: vi.fn().mockResolvedValue({ outcome: 'spoken' }),
    stopAsync: vi.fn().mockResolvedValue(undefined),
    acquireVoiceSessionAsync: vi.fn().mockResolvedValue({ held: true }),
    releaseVoiceSessionAsync: vi.fn().mockResolvedValue(undefined)
  }))
}))

describe('buildPetSpeechDeviceStatus and mobile identity', () => {
  beforeEach(async () => {
    await AsyncStorage.clear()
  })

  it('reports disabled status when pet speech is not enabled without voice details', async () => {
    await setPetSpeechEnabled(false)
    const status = await buildPetSpeechDeviceStatus()

    expect(status.enabled).toBe(false)
    expect(status.availability).toBe('disabled')
    expect(status.installUuid).toBeDefined()
    expect(status.installUuid.length).toBeGreaterThan(0)
    expect(status.modelName).toBeDefined()
    expect(status.selectedVoice).toBeUndefined()
    expect(status.rate).toBeUndefined()
  })

  it('reports enabled status with active engine, supported languages, rate, and voice', async () => {
    await setPetSpeechEnabled(true)
    await setPetSpeechRate(1.5)
    await setPetSpeechVoiceForLanguage('yue-HK', 'cmn-hk-x-f-local')

    const status = await buildPetSpeechDeviceStatus({
      currentLanguage: 'yue-HK',
      lastOutcome: 'spoken'
    })

    expect(status.enabled).toBe(true)
    expect(status.availability).toBe('available')
    expect(status.installUuid).toBeDefined()
    expect(status.activeEngine).toBe('com.google.android.tts')
    expect(status.supportedLanguages).toEqual(['yue-HK', 'en-US'])
    expect(status.currentLanguage).toBe('yue-HK')
    expect(status.selectedVoice).toBe('cmn-hk-x-f-local')
    expect(status.rate).toBe(1.5)
    expect(status.lastOutcome).toBe('spoken')
  })

  it('persists stable install UUID across preference reloads and multiple status builds', async () => {
    const p1 = await loadPetSpeechPreferences()
    const uuid1 = p1.installUuid
    expect(uuid1).toBeDefined()

    const s1 = await buildPetSpeechDeviceStatus()
    expect(s1.installUuid).toBe(uuid1)

    const p2 = await loadPetSpeechPreferences()
    expect(p2.installUuid).toBe(uuid1)

    const s2 = await buildPetSpeechDeviceStatus()
    expect(s2.installUuid).toBe(uuid1)
  })
})
