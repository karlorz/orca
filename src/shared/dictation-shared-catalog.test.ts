import { describe, expect, it } from 'vitest'
import { MAC_SYSTEM_SPEECH_MODEL_ID } from './voice-dictation-selection'
import {
  isListedMacAppleSpeechModel,
  listedMacAppleSpeechCatalogModel,
  phoneMicUsesListedMacAppleSpeech,
  sharedDictationCatalogListsMacAppleSpeech,
  type SharedDictationCatalogModel
} from './dictation-shared-catalog'

const MAC_APPLE_SPEECH_ROW: SharedDictationCatalogModel = {
  id: MAC_SYSTEM_SPEECH_MODEL_ID,
  label: 'Mac speech',
  provider: 'system',
  type: 'system',
  description: 'Built-in Apple Speech recognition on macOS. No download required.'
}

const PARAKEET_ROW: SharedDictationCatalogModel = {
  id: 'parakeet-tdt-0.6b-v3-int8',
  label: 'Parakeet TDT v3',
  provider: 'local'
}

const SHARED_CATALOG: SharedDictationCatalogModel[] = [PARAKEET_ROW, MAC_APPLE_SPEECH_ROW]

describe('shared dictation catalog — Mac Apple Speech listing', () => {
  it('lists Mac Apple Speech as a model for phone-mic → Mac Speech', () => {
    expect(sharedDictationCatalogListsMacAppleSpeech(SHARED_CATALOG)).toBe(true)
    const listed = listedMacAppleSpeechCatalogModel(SHARED_CATALOG)
    expect(listed).toEqual(MAC_APPLE_SPEECH_ROW)
    expect(listed?.description).toMatch(/Apple Speech/)
    expect(isListedMacAppleSpeechModel(MAC_APPLE_SPEECH_ROW)).toBe(true)
    expect(
      phoneMicUsesListedMacAppleSpeech(SHARED_CATALOG, {
        useMacSpeech: true,
        sttModel: 'parakeet-tdt-0.6b-v3-int8'
      })
    ).toBe(true)
  })

  it('does not treat downloadable or mislabeled rows as Mac Apple Speech', () => {
    expect(sharedDictationCatalogListsMacAppleSpeech([PARAKEET_ROW])).toBe(false)
    expect(
      sharedDictationCatalogListsMacAppleSpeech([
        { id: MAC_SYSTEM_SPEECH_MODEL_ID, label: 'Mac speech', provider: 'local' }
      ])
    ).toBe(false)
    expect(
      sharedDictationCatalogListsMacAppleSpeech([
        { id: MAC_SYSTEM_SPEECH_MODEL_ID, label: 'Apple Speech', provider: 'system' }
      ])
    ).toBe(false)
    expect(
      phoneMicUsesListedMacAppleSpeech(SHARED_CATALOG, {
        useMacSpeech: false,
        sttModel: 'parakeet-tdt-0.6b-v3-int8'
      })
    ).toBe(false)
    expect(phoneMicUsesListedMacAppleSpeech([PARAKEET_ROW], { useMacSpeech: true })).toBe(false)
  })
})
