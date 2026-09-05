import { describe, expect, it } from 'vitest'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { SpeechModelState } from '../../../../shared/speech-types'
import { MAC_SYSTEM_SPEECH_MODEL_ID } from '../../../../shared/voice-dictation-selection'
import { hasReadyVoiceModel } from './settings-navigation-foundations'

describe('hasReadyVoiceModel', () => {
  it('returns true when useMacSpeech is true and mac-system-speech is ready even if another model is not ready', () => {
    const settings = {
      voice: {
        enabled: true,
        useMacSpeech: true,
        sttModel: 'whisper-base'
      }
    } as unknown as GlobalSettings

    const states: SpeechModelState[] = [
      { id: MAC_SYSTEM_SPEECH_MODEL_ID, status: 'ready' },
      { id: 'whisper-base', status: 'not-downloaded' }
    ]

    expect(hasReadyVoiceModel(settings, states)).toBe(true)
  })

  it('returns false when useMacSpeech is true and mac-system-speech is unavailable even if a catalog model is ready in the background', () => {
    const settings = {
      voice: {
        enabled: true,
        useMacSpeech: true,
        sttModel: 'whisper-base'
      }
    } as unknown as GlobalSettings

    const states: SpeechModelState[] = [
      { id: MAC_SYSTEM_SPEECH_MODEL_ID, status: 'unavailable' },
      { id: 'whisper-base', status: 'ready' }
    ]

    expect(hasReadyVoiceModel(settings, states)).toBe(false)
  })

  it('checks effectiveSttModel when catalog model is selected and useMacSpeech is false', () => {
    const settings = {
      voice: {
        enabled: true,
        useMacSpeech: false,
        sttModel: 'whisper-base'
      }
    } as unknown as GlobalSettings

    const states: SpeechModelState[] = [
      { id: 'whisper-base', status: 'ready' }
    ]

    expect(hasReadyVoiceModel(settings, states)).toBe(true)
  })
})
