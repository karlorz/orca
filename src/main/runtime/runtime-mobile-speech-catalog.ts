import type { VoiceSettings } from '../../shared/speech-types'
import type { RuntimeSpeechModelSummary, RuntimeSpeechSetupState } from '../../shared/runtime-types'
import { getDefaultVoiceSettings } from '../../shared/constants'
import {
  isMacSpeechSelected,
  resolveMacSpeechToggleUpdates,
  MAC_SYSTEM_SPEECH_MODEL_ID
} from '../../shared/voice-dictation-selection'
import { getCatalogModel, isLocalSpeechModel, SPEECH_MODEL_CATALOG } from '../speech/model-catalog'
import { getSpeechModelManager, getSpeechSttService } from '../speech/speech-runtime-service'
import {
  deleteLocalSpeechModel,
  getSpeechModelDeletionErrorCode
} from '../speech/speech-model-deletion'
import type { RuntimeStore } from './runtime-store-contract'

export class RuntimeMobileSpeechCatalog {
  constructor(private readonly getStore: () => RuntimeStore | null) {}

  async list(): Promise<RuntimeSpeechSetupState> {
    const store = this.requireStore()
    const voice = store.getSettings().voice ?? getDefaultVoiceSettings()
    const states = await getSpeechModelManager(store).getModelStates()
    const stateById = new Map(states.map((state) => [state.id, state]))
    const models: RuntimeSpeechModelSummary[] = SPEECH_MODEL_CATALOG
      .filter((manifest) => manifest.provider !== 'system')
      .map((manifest) => {
        const state = stateById.get(manifest.id)
        const status = state?.status ?? 'not-downloaded'
        return {
          id: manifest.id,
          label: manifest.label,
          provider: manifest.provider,
          sizeBytes: manifest.sizeBytes ?? null,
          recommended: manifest.recommended === true,
          status,
          ...(status === 'unavailable' ? { unavailableReason: 'mac-only' as const } : {}),
          progress: state?.progress ?? null
        }
      })
    return {
      enabled: voice.enabled === true,
      useMacSpeech: isMacSpeechSelected(voice),
      macSpeechAvailable: process.platform === 'darwin',
      selectedModelId: voice.sttModel === MAC_SYSTEM_SPEECH_MODEL_ID ? '' : (voice.sttModel ?? ''),
      dictationMode: voice.dictationMode === 'hold' ? 'hold' : 'toggle',
      models
    }
  }

  async download(modelId: string): Promise<{ started: true }> {
    const store = this.requireStore()
    const manifest = getCatalogModel(modelId)
    if (!manifest || !isLocalSpeechModel(manifest)) {
      throw new Error('voice_model_not_downloadable')
    }
    void getSpeechModelManager(store)
      .downloadModel(modelId)
      .catch((err) =>
        console.error('[runtime] mobile speech model download failed', { modelId, err })
      )
    return { started: true }
  }

  async delete(modelId: string): Promise<RuntimeSpeechSetupState> {
    const store = this.requireWritableStore()
    try {
      await deleteLocalSpeechModel({
        store: {
          getSettings: () => store.getSettings(),
          updateSettings: (updates, options) => store.updateSettings?.(updates, options)
        },
        modelManager: getSpeechModelManager(store),
        sttService: getSpeechSttService(store),
        modelId
      })
    } catch (error) {
      throw new Error(getSpeechModelDeletionErrorCode(error) ?? 'voice_model_delete_failed')
    }
    return this.list()
  }

  async configure(params: {
    enabled?: boolean
    modelId?: string
    useMacSpeech?: boolean
    dictationMode?: 'toggle' | 'hold'
  }): Promise<RuntimeSpeechSetupState> {
    const store = this.requireWritableStore()
    const current = store.getSettings().voice ?? getDefaultVoiceSettings()

    let desiredUseMacSpeech = params.useMacSpeech
    let desiredModelId = params.modelId

    // Why: legacy clients send modelId='mac-system-speech' to select Mac speech
    if (desiredModelId === MAC_SYSTEM_SPEECH_MODEL_ID) {
      desiredUseMacSpeech = true
      desiredModelId = undefined
    }

    if (desiredUseMacSpeech === true && process.platform !== 'darwin') {
      throw new Error('voice_model_unavailable_on_host')
    }

    if (desiredModelId !== undefined && desiredModelId !== '') {
      const manifest = getCatalogModel(desiredModelId)
      if (!manifest) {
        throw new Error('voice_model_unknown')
      }
      if (manifest.provider === 'system' && process.platform !== 'darwin') {
        throw new Error('voice_model_unavailable_on_host')
      }
    }

    let macSpeechUpdates: Partial<VoiceSettings> = {}
    if (desiredUseMacSpeech !== undefined) {
      macSpeechUpdates = resolveMacSpeechToggleUpdates(current, desiredUseMacSpeech)
    }

    const nextVoice: VoiceSettings = {
      ...current,
      ...(params.enabled !== undefined ? { enabled: params.enabled } : {}),
      ...(desiredModelId !== undefined ? { sttModel: desiredModelId } : {}),
      ...(params.dictationMode !== undefined ? { dictationMode: params.dictationMode } : {}),
      ...macSpeechUpdates
    }
    store.updateSettings?.({ voice: nextVoice }, { notifyListeners: true })
    return this.list()
  }

  private requireStore(): RuntimeStore {
    const store = this.getStore()
    if (!store) {
      throw new Error('voice_dictation_unavailable')
    }
    return store
  }

  private requireWritableStore(): RuntimeStore {
    const store = this.requireStore()
    if (!store.getSettings || !store.updateSettings) {
      throw new Error('voice_dictation_unavailable')
    }
    return store
  }
}
