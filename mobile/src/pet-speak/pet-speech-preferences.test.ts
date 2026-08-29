import { beforeEach, describe, expect, it, vi } from 'vitest'
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  loadPetSpeechPreferences,
  setPetSpeechEnabled,
  setPetSpeechRate,
  setPetSpeechVoiceForLanguage,
  subscribePetSpeechPreferences,
  isParticipatingInstall,
  getOrCreateInstallUuid,
  PET_SPEECH_STORAGE_KEYS
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

describe('PetSpeechPreferences - Storage and Migration', () => {
  beforeEach(async () => {
    await AsyncStorage.clear()
  })

  it('fresh install (no existing pet speak keys) defaults to disabled (Off)', async () => {
    const prefs = await loadPetSpeechPreferences()
    expect(prefs.enabled).toBe(false)
    expect(prefs.migrationCompleted).toBe(false)
    expect(prefs.rate).toBe(1)
    expect(prefs.voiceByLanguage).toEqual({})
    expect(prefs.installUuid).toBeDefined()
    expect(prefs.installUuid.length).toBeGreaterThan(0)
  })

  it('detects participating install from existing watermark key and migrates On once', async () => {
    await AsyncStorage.setItem('orca:petSpeakWatermark:host-1', '{"seq": 5, "epoch": "ep1"}')
    expect(await isParticipatingInstall()).toBe(true)

    const prefs = await loadPetSpeechPreferences()
    expect(prefs.enabled).toBe(true)
    expect(prefs.migrationCompleted).toBe(true)

    // Check that migration flags were persisted
    expect(await AsyncStorage.getItem(PET_SPEECH_STORAGE_KEYS.ENABLED)).toBe('true')
    expect(await AsyncStorage.getItem(PET_SPEECH_STORAGE_KEYS.MIGRATION_COMPLETED)).toBe('true')
  })

  it('explicit Off choice after migration survives and is not overwritten', async () => {
    // Simulate previous migration to On
    await AsyncStorage.setItem(PET_SPEECH_STORAGE_KEYS.ENABLED, 'true')
    await AsyncStorage.setItem(PET_SPEECH_STORAGE_KEYS.MIGRATION_COMPLETED, 'true')

    // User explicitly turns it Off
    await setPetSpeechEnabled(false)

    const prefs = await loadPetSpeechPreferences()
    expect(prefs.enabled).toBe(false)
    expect(prefs.migrationCompleted).toBe(true)
  })

  it('explicit On choice survives app restart', async () => {
    await setPetSpeechEnabled(true)
    const prefs = await loadPetSpeechPreferences()
    expect(prefs.enabled).toBe(true)
    expect(prefs.migrationCompleted).toBe(true)
  })

  it('persists and retrieves rate setting within bounds', async () => {
    await setPetSpeechRate(1.5)
    let prefs = await loadPetSpeechPreferences()
    expect(prefs.rate).toBe(1.5)

    // Clamps rate
    await setPetSpeechRate(5)
    prefs = await loadPetSpeechPreferences()
    expect(prefs.rate).toBe(3)

    await setPetSpeechRate(0.1)
    prefs = await loadPetSpeechPreferences()
    expect(prefs.rate).toBe(0.5)
  })

  it('persists and retrieves voiceByLanguage independently per canonical language', async () => {
    await setPetSpeechVoiceForLanguage('yue-HK', 'cmn-hk-x-yue-local')
    await setPetSpeechVoiceForLanguage('en-US', 'en-us-x-sfg-local')

    let prefs = await loadPetSpeechPreferences()
    expect(prefs.voiceByLanguage['yue-HK']).toBe('cmn-hk-x-yue-local')
    expect(prefs.voiceByLanguage['en-US']).toBe('en-us-x-sfg-local')
    expect(prefs.voiceByLanguage['zh-CN']).toBeUndefined()

    // Clear one language selection
    await setPetSpeechVoiceForLanguage('yue-HK', null)
    prefs = await loadPetSpeechPreferences()
    expect(prefs.voiceByLanguage['yue-HK']).toBeUndefined()
    expect(prefs.voiceByLanguage['en-US']).toBe('en-us-x-sfg-local')
  })

  it('preserves installUuid across multiple loads', async () => {
    const uuid1 = await getOrCreateInstallUuid()
    const uuid2 = await getOrCreateInstallUuid()
    expect(uuid1).toBe(uuid2)
  })

  it('notifies subscribers on preference changes', async () => {
    let callCount = 0
    let lastPrefs: unknown = null
    const unsub = subscribePetSpeechPreferences((prefs) => {
      callCount++
      lastPrefs = prefs
    })

    await setPetSpeechEnabled(true)
    // Wait for async notification
    await new Promise((r) => setTimeout(r, 10))

    expect(callCount).toBe(1)
    expect(lastPrefs.enabled).toBe(true)

    unsub()
  })
})
