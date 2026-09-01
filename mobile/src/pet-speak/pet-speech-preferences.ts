import AsyncStorage from '@react-native-async-storage/async-storage'
import type { CanonicalLanguage } from './pet-language-normalizer'

export interface PetSpeechPreferences {
  enabled: boolean
  captionsEnabled: boolean
  captionOffset: { x: number; y: number }
  migrationCompleted: boolean
  installUuid: string
  rate: number
  voiceByLanguage: Partial<Record<CanonicalLanguage, string>>
}

export const PET_SPEECH_STORAGE_KEYS = {
  ENABLED: 'orca:petSpeech:enabled',
  MIGRATION_COMPLETED: 'orca:petSpeech:migrationCompleted',
  INSTALL_UUID: 'orca:petSpeech:installUuid',
  RATE: 'orca:petSpeech:rate',
  VOICE_BY_LANGUAGE: 'orca:petSpeech:voiceByLanguage',
  CAPTIONS_ENABLED: 'orca:petSpeech:captionsEnabled',
  CAPTION_OFFSET: 'orca:petSpeech:captionOffset'
} as const

export const DEFAULT_PET_SPEECH_RATE = 1

/**
 * Migration predicate for existing installations.
 *
 * An existing installation is considered "participating" if:
 * 1. An existing watermark key exists matching 'orca:petSpeakWatermark:*' in AsyncStorage, OR
 * 2. Any existing keys starting with 'orca:petSpeak' or 'orca:pet-speak' are found in AsyncStorage.
 *
 * This indicates the app has previously subscribed to or processed pet speech events.
 * Fresh installations (with no such keys) will evaluate to false and default to Disabled (Off).
 */
export async function isParticipatingInstall(): Promise<boolean> {
  try {
    const allKeys = await AsyncStorage.getAllKeys()
    return allKeys.some(
      (key) => key.startsWith('orca:petSpeak') || key.startsWith('orca:pet-speak:')
    )
  } catch {
    return false
  }
}

/**
 * Loads the stable install UUID, generating and persisting one if not yet present.
 */
export async function getOrCreateInstallUuid(): Promise<string> {
  try {
    const existing = await AsyncStorage.getItem(PET_SPEECH_STORAGE_KEYS.INSTALL_UUID)
    if (existing && existing.trim().length > 0) {
      return existing.trim()
    }
    const newUuid = generateStableUuid()
    await AsyncStorage.setItem(PET_SPEECH_STORAGE_KEYS.INSTALL_UUID, newUuid)
    return newUuid
  } catch {
    return generateStableUuid()
  }
}

function generateStableUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/**
 * Resolves the initial or persisted Pet Speech preferences.
 *
 * Migration rule:
 * - If migration has already completed (migrationCompleted === true), uses the persisted enabled state.
 * - If migration has NOT run:
 *   - Checks isParticipatingInstall(). If participating, enabled defaults to true and migration is marked complete ONCE.
 *   - If not participating (fresh install), enabled defaults to false (Off), but migration is NOT marked complete yet until explicit interaction or stays fresh.
 *   - Never overwrites later explicit Off/On choices.
 */
export async function loadPetSpeechPreferences(): Promise<PetSpeechPreferences> {
  const [
    rawEnabled,
    rawMigrationCompleted,
    rawRate,
    rawVoiceByLanguage,
    rawCaptionsEnabled,
    rawCaptionOffset,
    installUuid
  ] = await Promise.all([
    AsyncStorage.getItem(PET_SPEECH_STORAGE_KEYS.ENABLED),
    AsyncStorage.getItem(PET_SPEECH_STORAGE_KEYS.MIGRATION_COMPLETED),
    AsyncStorage.getItem(PET_SPEECH_STORAGE_KEYS.RATE),
    AsyncStorage.getItem(PET_SPEECH_STORAGE_KEYS.VOICE_BY_LANGUAGE),
    AsyncStorage.getItem(PET_SPEECH_STORAGE_KEYS.CAPTIONS_ENABLED),
    AsyncStorage.getItem(PET_SPEECH_STORAGE_KEYS.CAPTION_OFFSET),
    getOrCreateInstallUuid()
  ])

  let migrationCompleted = rawMigrationCompleted === 'true'
  let enabled = false

  if (rawEnabled !== null) {
    // Explicit user choice already recorded
    enabled = rawEnabled === 'true'
  } else if (!migrationCompleted) {
    // Run one-time migration check
    const participating = await isParticipatingInstall()
    if (participating) {
      enabled = true
      migrationCompleted = true
      // Persist migrated enabled state and mark migration completed ONCE
      await Promise.all([
        AsyncStorage.setItem(PET_SPEECH_STORAGE_KEYS.ENABLED, 'true'),
        AsyncStorage.setItem(PET_SPEECH_STORAGE_KEYS.MIGRATION_COMPLETED, 'true')
      ])
    } else {
      enabled = false
    }
  }

  let rate = DEFAULT_PET_SPEECH_RATE
  if (rawRate !== null) {
    const parsed = Number.parseFloat(rawRate)
    if (!Number.isNaN(parsed) && parsed >= 0.5 && parsed <= 3) {
      rate = parsed
    }
  }

  let voiceByLanguage: Partial<Record<CanonicalLanguage, string>> = {}
  if (rawVoiceByLanguage) {
    try {
      const parsed = JSON.parse(rawVoiceByLanguage)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        voiceByLanguage = parsed
      }
    } catch {
      voiceByLanguage = {}
    }
  }

  let captionOffset = { x: 0, y: 0 }
  if (rawCaptionOffset) {
    try {
      const parsed = JSON.parse(rawCaptionOffset)
      if (
        parsed &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        typeof parsed.x === 'number' &&
        typeof parsed.y === 'number'
      ) {
        captionOffset = { x: parsed.x, y: parsed.y }
      }
    } catch {
      captionOffset = { x: 0, y: 0 }
    }
  }

  return {
    enabled,
    captionsEnabled: rawCaptionsEnabled === 'true',
    captionOffset,
    migrationCompleted,
    installUuid,
    rate,
    voiceByLanguage
  }
}

export async function setPetSpeechCaptionOffset(offset: { x: number; y: number }): Promise<void> {
  await AsyncStorage.setItem(PET_SPEECH_STORAGE_KEYS.CAPTION_OFFSET, JSON.stringify(offset))
  notifyPreferencesListeners()
}

export async function setPetSpeechCaptionsEnabled(captionsEnabled: boolean): Promise<void> {
  await AsyncStorage.setItem(
    PET_SPEECH_STORAGE_KEYS.CAPTIONS_ENABLED,
    captionsEnabled ? 'true' : 'false'
  )
  notifyPreferencesListeners()
}

export async function setPetSpeechEnabled(enabled: boolean): Promise<void> {
  await Promise.all([
    AsyncStorage.setItem(PET_SPEECH_STORAGE_KEYS.ENABLED, enabled ? 'true' : 'false'),
    AsyncStorage.setItem(PET_SPEECH_STORAGE_KEYS.MIGRATION_COMPLETED, 'true')
  ])
  notifyPreferencesListeners()
}

export async function setPetSpeechRate(rate: number): Promise<void> {
  const boundedRate = Math.min(3, Math.max(0.5, rate))
  await AsyncStorage.setItem(PET_SPEECH_STORAGE_KEYS.RATE, boundedRate.toString())
  notifyPreferencesListeners()
}

export async function setPetSpeechVoiceForLanguage(
  language: CanonicalLanguage,
  voiceName: string | null
): Promise<void> {
  const current = await loadPetSpeechPreferences()
  const updated = { ...current.voiceByLanguage }
  if (voiceName === null || voiceName.trim() === '') {
    delete updated[language]
  } else {
    updated[language] = voiceName.trim()
  }
  await AsyncStorage.setItem(PET_SPEECH_STORAGE_KEYS.VOICE_BY_LANGUAGE, JSON.stringify(updated))
  notifyPreferencesListeners()
}

type PreferencesListener = (prefs: PetSpeechPreferences) => void
const listeners = new Set<PreferencesListener>()

export function subscribePetSpeechPreferences(listener: PreferencesListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function notifyPreferencesListeners(): void {
  void loadPetSpeechPreferences().then((prefs) => {
    for (const listener of listeners) {
      try {
        listener(prefs)
      } catch {}
    }
  })
}
