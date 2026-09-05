import { describe, expect, it } from 'vitest'
import {
  MAC_SYSTEM_SPEECH_MODEL_ID,
  canStartVoiceDictation,
  effectiveSttModel,
  isMacSpeechSelected,
  resolveMacSpeechToggleUpdates
} from './voice-dictation-selection'

describe('voice-dictation-selection', () => {
  it('treats useMacSpeech=true as mac speech selected', () => {
    expect(isMacSpeechSelected({ useMacSpeech: true, sttModel: 'whisper-base' })).toBe(true)
    expect(effectiveSttModel({ useMacSpeech: true, sttModel: 'whisper-base' })).toBe(
      MAC_SYSTEM_SPEECH_MODEL_ID
    )
  })

  it('treats legacy sttModel=mac-system-speech as mac speech selected', () => {
    expect(isMacSpeechSelected({ useMacSpeech: false, sttModel: MAC_SYSTEM_SPEECH_MODEL_ID })).toBe(
      true
    )
    expect(effectiveSttModel({ sttModel: MAC_SYSTEM_SPEECH_MODEL_ID })).toBe(
      MAC_SYSTEM_SPEECH_MODEL_ID
    )
  })

  it('restores last catalog model when useMacSpeech is false', () => {
    expect(isMacSpeechSelected({ useMacSpeech: false, sttModel: 'whisper-base' })).toBe(false)
    expect(effectiveSttModel({ useMacSpeech: false, sttModel: 'whisper-base' })).toBe('whisper-base')
  })

  it('returns empty string when no model is selected and mac speech is off', () => {
    expect(isMacSpeechSelected({ useMacSpeech: false, sttModel: '' })).toBe(false)
    expect(effectiveSttModel({ useMacSpeech: false, sttModel: '' })).toBe('')
    expect(effectiveSttModel(null)).toBe('')
  })

  it('evaluates canStartVoiceDictation correctly', () => {
    expect(canStartVoiceDictation({ enabled: true, useMacSpeech: true })).toBe(true)
    expect(
      canStartVoiceDictation({ enabled: true, useMacSpeech: false, sttModel: 'whisper-base' })
    ).toBe(true)
    expect(canStartVoiceDictation({ enabled: true, sttModel: MAC_SYSTEM_SPEECH_MODEL_ID })).toBe(
      true
    )
    expect(canStartVoiceDictation({ enabled: false, useMacSpeech: true })).toBe(false)
    expect(canStartVoiceDictation({ enabled: true, useMacSpeech: false, sttModel: '' })).toBe(false)
    expect(canStartVoiceDictation(null)).toBe(false)
  })

  it('resolves toggle updates clearing legacy sttModel to empty string', () => {
    // When turning ON from legacy sttModel
    expect(
      resolveMacSpeechToggleUpdates({ sttModel: MAC_SYSTEM_SPEECH_MODEL_ID }, true)
    ).toEqual({
      useMacSpeech: true,
      sttModel: ''
    })

    // When turning OFF from legacy sttModel
    expect(
      resolveMacSpeechToggleUpdates({ sttModel: MAC_SYSTEM_SPEECH_MODEL_ID }, false)
    ).toEqual({
      useMacSpeech: false,
      sttModel: ''
    })

    // When turning ON preserving catalog sttModel
    expect(
      resolveMacSpeechToggleUpdates({ sttModel: 'whisper-base' }, true)
    ).toEqual({
      useMacSpeech: true
    })

    // When turning OFF preserving catalog sttModel
    expect(
      resolveMacSpeechToggleUpdates({ sttModel: 'whisper-base' }, false)
    ).toEqual({
      useMacSpeech: false
    })
  })
})
