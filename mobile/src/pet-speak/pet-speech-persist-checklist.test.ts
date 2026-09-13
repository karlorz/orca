import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PetSpeechPreferences } from './pet-speech-preferences'

const updatePersistSettingsAsync = vi.fn(async () => {})
const getPersistChecklistAsync = vi.fn(async () => ({
  notificationsGranted: true,
  ignoringBattery: false,
  canOpenDeviceGuard: true,
  canDrawOverlays: false
}))
const openPersistChecklistItemAsync = vi.fn(async () => {})

vi.mock('@orca/expo-pet-speech', () => ({
  getExpoPetSpeechModule: () => ({
    updatePersistSettingsAsync,
    getPersistChecklistAsync,
    openPersistChecklistItemAsync
  })
}))

import {
  loadPetSpeechPersistChecklist,
  openPetSpeechPersistChecklistItem,
  persistSettingsFromPreferences,
  syncPetSpeechPersistSettings
} from './pet-speech-persist-checklist'

const prefs: PetSpeechPreferences = {
  enabled: true,
  captionsEnabled: false,
  captionOffset: { x: 0, y: 0 },
  migrationCompleted: true,
  installUuid: 'u',
  rate: 1,
  voiceByLanguage: {},
  persistEnabled: true,
  keepWhenNoHost: false,
  showServiceStatusRow: true,
  overlayWhileSpeaking: false
}

describe('pet-speech persist checklist', () => {
  beforeEach(() => {
    updatePersistSettingsAsync.mockClear()
    getPersistChecklistAsync.mockClear()
    openPersistChecklistItemAsync.mockClear()
  })

  it('maps preferences to native persist settings', () => {
    expect(persistSettingsFromPreferences(prefs)).toEqual({
      masterEnabled: true,
      persistEnabled: true,
      keepWhenNoHost: false,
      showServiceStatusRow: true,
      overlayWhileSpeaking: false
    })
  })

  it('syncs persist settings to native', async () => {
    await syncPetSpeechPersistSettings(prefs)
    expect(updatePersistSettingsAsync).toHaveBeenCalledWith({
      masterEnabled: true,
      persistEnabled: true,
      keepWhenNoHost: false,
      showServiceStatusRow: true,
      overlayWhileSpeaking: false
    })
  })

  it('loads checklist from native', async () => {
    await expect(loadPetSpeechPersistChecklist()).resolves.toEqual({
      notificationsGranted: true,
      ignoringBattery: false,
      canOpenDeviceGuard: true,
      canDrawOverlays: false
    })
  })

  it('opens a checklist item through native', async () => {
    await openPetSpeechPersistChecklistItem('device-guard')
    expect(openPersistChecklistItemAsync).toHaveBeenCalledWith('device-guard')
  })
})
