import type { VoiceSettings } from './speech-types'

export const MAC_SYSTEM_SPEECH_MODEL_ID = 'mac-system-speech'

export function isMacSpeechSelected(
  voice: { useMacSpeech?: boolean; sttModel?: string } | null | undefined
): boolean {
  return voice?.useMacSpeech === true || voice?.sttModel === MAC_SYSTEM_SPEECH_MODEL_ID
}

export function effectiveSttModel(
  voice: { useMacSpeech?: boolean; sttModel?: string } | null | undefined
): string {
  if (isMacSpeechSelected(voice)) {
    return MAC_SYSTEM_SPEECH_MODEL_ID
  }
  return voice?.sttModel || ''
}

export function canStartVoiceDictation(
  voice: { enabled?: boolean; useMacSpeech?: boolean; sttModel?: string } | null | undefined
): boolean {
  return voice?.enabled === true && effectiveSttModel(voice) !== ''
}

// Why: clears legacy sttModel so system ID does not linger in catalog selection state.
export function resolveMacSpeechToggleUpdates(
  currentVoice: { sttModel?: string } | null | undefined,
  useMacSpeech: boolean
): Partial<VoiceSettings> {
  const updates: Partial<VoiceSettings> = { useMacSpeech }
  if (currentVoice?.sttModel === MAC_SYSTEM_SPEECH_MODEL_ID) {
    updates.sttModel = ''
  }
  return updates
}
