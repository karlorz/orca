import { Linking } from 'react-native'
import { getExpoPetSpeechModule, type PetSpeechPersistChecklist } from '@orca/expo-pet-speech'
import { ensureNotificationPermissions } from '../notifications/notification-permissions'
import type { PetSpeechPreferences } from './pet-speech-preferences'
import { persistWriteReleaseReason } from './pet-speech-persist-write-decision'

const EMPTY_CHECKLIST: PetSpeechPersistChecklist = {
  notificationsGranted: false,
  ignoringBattery: false,
  canOpenDeviceGuard: false,
  canDrawOverlays: false
}

export function persistSettingsFromPreferences(prefs: PetSpeechPreferences) {
  return {
    masterEnabled: prefs.enabled,
    persistEnabled: prefs.persistEnabled,
    keepWhenNoHost: prefs.keepWhenNoHost,
    showServiceStatusRow: prefs.showServiceStatusRow,
    overlayWhileSpeaking: prefs.overlayWhileSpeaking
  }
}

export function persistWriteReasonFromPreferences(prefs: PetSpeechPreferences) {
  return persistWriteReleaseReason(prefs.persistEnabled, prefs.enabled)
}

export async function syncPetSpeechPersistSettings(prefs: PetSpeechPreferences): Promise<void> {
  const native = getExpoPetSpeechModule()
  if (!native?.updatePersistSettingsAsync) {
    return
  }
  persistWriteReasonFromPreferences(prefs)
  await native.updatePersistSettingsAsync(persistSettingsFromPreferences(prefs))
}

export async function loadPetSpeechPersistChecklist(): Promise<PetSpeechPersistChecklist> {
  const native = getExpoPetSpeechModule()
  if (!native?.getPersistChecklistAsync) {
    return EMPTY_CHECKLIST
  }
  try {
    return await native.getPersistChecklistAsync()
  } catch {
    return EMPTY_CHECKLIST
  }
}

export function persistDependentSwitchEnabled(persistEnabled: boolean): boolean {
  return persistEnabled
}

export function shouldRequestOverlayPermissionOnToggle(wasOn: boolean, nowOn: boolean): boolean {
  return nowOn && !wasOn
}

export async function applyOverlayWhileSpeakingToggle(
  nowOn: boolean,
  wasOn: boolean
): Promise<boolean> {
  if (!shouldRequestOverlayPermissionOnToggle(wasOn, nowOn)) {
    return true
  }
  return openPetSpeechPersistChecklistItem('overlay')
}

export async function openPetSpeechPersistChecklistItem(
  item: 'notifications' | 'battery' | 'device-guard' | 'lock-channel' | 'overlay'
): Promise<boolean> {
  if (item === 'notifications') {
    await ensureNotificationPermissions()
  }
  const native = getExpoPetSpeechModule()
  if (native?.openPersistChecklistItemAsync) {
    try {
      const result = await native.openPersistChecklistItemAsync(item)
      if (result && typeof result === 'object' && result.opened === false) {
        await Linking.openSettings()
        return false
      }
      return true
    } catch {
      await Linking.openSettings()
      return false
    }
  }
  await Linking.openSettings()
  return false
}
