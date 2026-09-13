import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PetSpeechPreferences } from './pet-speech-preferences'

const {
  updatePersistSettingsAsync,
  getPersistChecklistAsync,
  openPersistChecklistItemAsync,
  openSettings,
  ensureNotificationPermissions
} = vi.hoisted(() => ({
  updatePersistSettingsAsync: vi.fn(async () => {}),
  getPersistChecklistAsync: vi.fn(async () => ({
    notificationsGranted: true,
    ignoringBattery: false,
    canOpenDeviceGuard: true,
    canDrawOverlays: false
  })),
  openPersistChecklistItemAsync: vi.fn(async () => ({ opened: true })),
  openSettings: vi.fn(async () => {}),
  ensureNotificationPermissions: vi.fn(async () => true)
}))

vi.mock('react-native', () => ({
  Linking: {
    openSettings
  }
}))

vi.mock('../notifications/notification-permissions', () => ({
  ensureNotificationPermissions
}))

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
    openSettings.mockClear()
    ensureNotificationPermissions.mockClear()
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
    await expect(openPetSpeechPersistChecklistItem('device-guard')).resolves.toBe(true)
    expect(openPersistChecklistItemAsync).toHaveBeenCalledWith('device-guard')
    expect(openSettings).not.toHaveBeenCalled()
  })

  it('asks notification permission then deep-links notifications', async () => {
    await expect(openPetSpeechPersistChecklistItem('notifications')).resolves.toBe(true)
    expect(ensureNotificationPermissions).toHaveBeenCalled()
    expect(openPersistChecklistItemAsync).toHaveBeenCalledWith('notifications')
  })

  it('falls back to app settings when native cannot open', async () => {
    openPersistChecklistItemAsync.mockResolvedValueOnce({ opened: false })
    await expect(openPetSpeechPersistChecklistItem('battery')).resolves.toBe(false)
    expect(openSettings).toHaveBeenCalled()
  })
})
