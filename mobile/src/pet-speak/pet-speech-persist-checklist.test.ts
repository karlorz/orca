import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PetSpeechPreferences } from './pet-speech-preferences'

const {
  updatePersistSettingsAsync,
  getPersistChecklistAsync,
  openPersistChecklistItemAsync,
  openSettings,
  ensureNotificationPermissions,
  getExpoPetSpeechModule
} = vi.hoisted(() => {
  const updatePersistSettingsAsync = vi.fn(async () => {})
  const getPersistChecklistAsync = vi.fn(async () => ({
    notificationsGranted: true,
    ignoringBattery: false,
    canOpenDeviceGuard: true,
    canDrawOverlays: false
  }))
  const openPersistChecklistItemAsync = vi.fn(async () => ({ opened: true }))
  return {
    updatePersistSettingsAsync,
    getPersistChecklistAsync,
    openPersistChecklistItemAsync,
    openSettings: vi.fn(async () => {}),
    ensureNotificationPermissions: vi.fn(async () => true),
    getExpoPetSpeechModule: vi.fn(() => ({
      updatePersistSettingsAsync,
      getPersistChecklistAsync,
      openPersistChecklistItemAsync
    }))
  }
})

vi.mock('react-native', () => ({
  Linking: {
    openSettings
  }
}))

vi.mock('../notifications/notification-permissions', () => ({
  ensureNotificationPermissions
}))

vi.mock('@orca/expo-pet-speech', () => ({
  getExpoPetSpeechModule
}))

import {
  applyOverlayWhileSpeakingToggle,
  loadPetSpeechPersistChecklist,
  openPetSpeechPersistChecklistItem,
  persistSettingsFromPreferences,
  persistDependentSwitchEnabled,
  persistWriteReasonFromPreferences,
  shouldRequestOverlayPermissionOnToggle,
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
  keepHostConnection: false,
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
    getExpoPetSpeechModule.mockReset()
    getExpoPetSpeechModule.mockImplementation(() => ({
      updatePersistSettingsAsync,
      getPersistChecklistAsync,
      openPersistChecklistItemAsync
    }))
  })

  it('maps preferences to native persist settings', () => {
    expect(persistSettingsFromPreferences(prefs)).toEqual({
      masterEnabled: true,
      persistEnabled: true,
      keepWhenNoHost: false,
      showServiceStatusRow: true,
      overlayWhileSpeaking: false
    })
    expect(persistWriteReasonFromPreferences(prefs)).toBeNull()
    expect(
      persistWriteReasonFromPreferences({
        ...prefs,
        persistEnabled: false,
        overlayWhileSpeaking: true
      })
    ).toBe('PERSIST_OFF_STOP')
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

  it('fail-opens an empty checklist when native is missing or throws', async () => {
    const empty = {
      notificationsGranted: false,
      ignoringBattery: false,
      canOpenDeviceGuard: false,
      canDrawOverlays: false
    }
    getExpoPetSpeechModule.mockReturnValueOnce(null)
    await expect(loadPetSpeechPersistChecklist()).resolves.toEqual(empty)
    getExpoPetSpeechModule.mockReturnValueOnce({})
    await expect(loadPetSpeechPersistChecklist()).resolves.toEqual(empty)
    getPersistChecklistAsync.mockRejectedValueOnce(new Error('native checklist failed'))
    await expect(loadPetSpeechPersistChecklist()).resolves.toEqual(empty)
  })

  it('no-ops persist sync when native update is missing', async () => {
    getExpoPetSpeechModule.mockReturnValueOnce({})
    await expect(syncPetSpeechPersistSettings(prefs)).resolves.toBeUndefined()
    expect(updatePersistSettingsAsync).not.toHaveBeenCalled()
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

  it('falls back to app settings when native open is missing or throws', async () => {
    getExpoPetSpeechModule.mockReturnValueOnce({})
    await expect(openPetSpeechPersistChecklistItem('battery')).resolves.toBe(false)
    expect(openSettings).toHaveBeenCalled()
    expect(openPersistChecklistItemAsync).not.toHaveBeenCalled()

    openSettings.mockClear()
    openPersistChecklistItemAsync.mockRejectedValueOnce(new Error('native open failed'))
    await expect(openPetSpeechPersistChecklistItem('overlay')).resolves.toBe(false)
    expect(openSettings).toHaveBeenCalled()
  })

  it('disables persist-dependent switches when persist is off', () => {
    expect(persistDependentSwitchEnabled(true)).toBe(true)
    expect(persistDependentSwitchEnabled(false)).toBe(false)
  })

  it('requests overlay permission only when the switch turns on', async () => {
    expect(shouldRequestOverlayPermissionOnToggle(false, true)).toBe(true)
    expect(shouldRequestOverlayPermissionOnToggle(true, true)).toBe(false)
    expect(shouldRequestOverlayPermissionOnToggle(true, false)).toBe(false)
    expect(shouldRequestOverlayPermissionOnToggle(false, false)).toBe(false)

    await expect(applyOverlayWhileSpeakingToggle(true, false)).resolves.toBe(true)
    expect(openPersistChecklistItemAsync).toHaveBeenCalledWith('overlay')
    expect(openSettings).not.toHaveBeenCalled()

    openPersistChecklistItemAsync.mockClear()
    await expect(applyOverlayWhileSpeakingToggle(false, true)).resolves.toBe(true)
    await expect(applyOverlayWhileSpeakingToggle(true, true)).resolves.toBe(true)
    expect(openPersistChecklistItemAsync).not.toHaveBeenCalled()
  })
})
