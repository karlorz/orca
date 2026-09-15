import { MAC_SYSTEM_SPEECH_MODEL_ID, effectiveSttModel } from './voice-dictation-selection'

export type SharedDictationCatalogModel = {
  id: string
  label: string
  provider: string
  type?: string
  description?: string
}

export function isListedMacAppleSpeechModel(model: SharedDictationCatalogModel): boolean {
  return (
    model.id === MAC_SYSTEM_SPEECH_MODEL_ID &&
    model.provider === 'system' &&
    model.label === 'Mac speech'
  )
}

export function listedMacAppleSpeechCatalogModel(
  models: readonly SharedDictationCatalogModel[]
): SharedDictationCatalogModel | undefined {
  return models.find(isListedMacAppleSpeechModel)
}

export function sharedDictationCatalogListsMacAppleSpeech(
  models: readonly SharedDictationCatalogModel[]
): boolean {
  return listedMacAppleSpeechCatalogModel(models) != null
}

/** Phone mic → Mac Apple Speech when Use Mac speech is on and the shared catalog lists that model. */
export function phoneMicUsesListedMacAppleSpeech(
  models: readonly SharedDictationCatalogModel[],
  voice: { useMacSpeech?: boolean; sttModel?: string } | null | undefined
): boolean {
  return (
    sharedDictationCatalogListsMacAppleSpeech(models) &&
    effectiveSttModel(voice) === MAC_SYSTEM_SPEECH_MODEL_ID
  )
}
