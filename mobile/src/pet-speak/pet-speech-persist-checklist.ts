import { getExpoPetSpeechModule, type PetSpeechPersistChecklist } from '@orca/expo-pet-speech'
import type { PetSpeechPreferences } from './pet-speech-preferences'

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

export async function syncPetSpeechPersistSettings(prefs: PetSpeechPreferences): Promise<void> {
  const native = getExpoPetSpeechModule()
  if (!native?.updatePersistSettingsAsync) {
    return
  }
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

export async function openPetSpeechPersistChecklistItem(
  item: 'notifications' | 'battery' | 'device-guard' | 'lock-channel' | 'overlay'
): Promise<void> {
  const native = getExpoPetSpeechModule()
  if (!native?.openPersistChecklistItemAsync) {
    return
  }
  await native.openPersistChecklistItemAsync(item)
}
