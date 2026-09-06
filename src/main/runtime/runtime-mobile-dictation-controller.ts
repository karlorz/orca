import { getDefaultVoiceSettings } from '../../shared/constants'
import {
  effectiveSttModel,
  isMacSpeechSelected,
  MAC_SYSTEM_SPEECH_MODEL_ID
} from '../../shared/voice-dictation-selection'
import { getSpeechModelManager, getSpeechSttService } from '../speech/speech-runtime-service'
import { joinTranscriptSegments } from '../../shared/dictation-segment-format'
import type { RuntimeStore } from './runtime-store-contract'

export type MobileDictationLiveSnapshot = {
  dictationId: string
  revision: number
  committedText: string
  partialText: string
  live: boolean
}

type MobileDictationSession = {
  id: string
  owner: string
  clientId?: string
  connectionId?: string
  state: 'starting' | 'active' | 'closing'
  partialText: string
  finalTexts: string[]
  errors: string[]
  revision: number
  live: boolean
}

function snapshotFor(session: MobileDictationSession): MobileDictationLiveSnapshot {
  return {
    dictationId: session.id,
    revision: session.revision,
    committedText: joinTranscriptSegments(session.finalTexts),
    partialText: session.partialText,
    live: session.live
  }
}

export class RuntimeMobileDictationController {
  private session: MobileDictationSession | null = null

  constructor(private readonly getStore: () => RuntimeStore | null) {}

  async start(params: {
    dictationId: string
    modelId?: string
    clientId?: string
    connectionId?: string
  }): Promise<{ dictationId: string; modelId: string }> {
    const store = this.requireStore()
    const voice = store.getSettings().voice ?? getDefaultVoiceSettings()
    if (!voice.enabled) {
      throw new Error('voice_dictation_disabled')
    }
    const modelId =
      isMacSpeechSelected(voice) || params.modelId === MAC_SYSTEM_SPEECH_MODEL_ID
        ? MAC_SYSTEM_SPEECH_MODEL_ID
        : params.modelId || effectiveSttModel(voice)
    if (!modelId) {
      throw new Error('voice_model_not_selected')
    }
    const modelState = await getSpeechModelManager(store).getModelState(modelId)
    if (modelState.status !== 'ready') {
      throw new Error(`voice_model_not_ready:${modelState.status}`)
    }
    if (!params.clientId) {
      throw new Error('dictation_requires_mobile_client')
    }
    if (this.session) {
      throw new Error('dictation_already_active')
    }

    const owner = `mobile:${params.dictationId}`
    this.session = {
      id: params.dictationId,
      owner,
      clientId: params.clientId,
      connectionId: params.connectionId,
      state: 'starting',
      partialText: '',
      finalTexts: [],
      errors: [],
      revision: 0,
      live: isMacSpeechSelected(voice) || modelId === MAC_SYSTEM_SPEECH_MODEL_ID
    }
    try {
      await getSpeechSttService(store).startDictation(
        modelId,
        (event) => this.acceptEvent(params.dictationId, event),
        undefined,
        owner
      )
      if (this.session?.id !== params.dictationId) {
        throw new Error('dictation_canceled')
      }
      this.session.state = 'active'
    } catch (error) {
      if (this.session?.id === params.dictationId) {
        this.session = null
      }
      throw error
    }
    return { dictationId: params.dictationId, modelId }
  }

  feed(params: {
    dictationId: string
    audioBase64: string
    sampleRate: number
    clientId?: string
    connectionId?: string
  }): MobileDictationLiveSnapshot {
    const session = this.requireOwnedSession(params)
    if (session.state !== 'active') {
      return snapshotFor(session)
    }
    if (session.errors.length > 0) {
      throw new Error(session.errors[0])
    }
    const pcm = Buffer.from(params.audioBase64, 'base64')
    const samples = new Float32Array(Math.floor(pcm.length / 2))
    for (let i = 0; i < samples.length; i += 1) {
      samples[i] = pcm.readInt16LE(i * 2) / 32768
    }
    getSpeechSttService(this.requireStore()).feedAudio(samples, params.sampleRate, session.owner)
    return snapshotFor(session)
  }

  async finish(params: {
    dictationId: string
    clientId?: string
    connectionId?: string
  }): Promise<{ dictationId: string; text: string }> {
    const session = this.requireOwnedSession(params)
    session.state = 'closing'
    try {
      await getSpeechSttService(this.requireStore()).stopDictation(session.owner)
      if (session.errors.length > 0) {
        throw new Error(session.errors[0])
      }
      return {
        dictationId: params.dictationId,
        text: joinTranscriptSegments([...session.finalTexts, session.partialText])
      }
    } finally {
      if (this.session?.id === session.id) {
        this.session = null
      }
    }
  }

  async cancel(params: {
    dictationId: string
    clientId?: string
    connectionId?: string
  }): Promise<{ dictationId: string }> {
    const session = this.session
    if (
      session?.id === params.dictationId &&
      params.clientId &&
      session.clientId === params.clientId &&
      (!session.connectionId || session.connectionId === params.connectionId)
    ) {
      session.state = 'closing'
      try {
        await getSpeechSttService(this.requireStore()).stopDictation(session.owner)
      } finally {
        if (this.session?.id === session.id) {
          this.session = null
        }
      }
    }
    return { dictationId: params.dictationId }
  }

  cancelForConnection(connectionId: string): void {
    if (this.session?.connectionId === connectionId) {
      this.cancelSession(this.session)
    }
  }

  cancelForClient(clientId: string): void {
    if (this.session?.clientId === clientId) {
      this.cancelSession(this.session)
    }
  }

  private acceptEvent(
    dictationId: string,
    event: { type: string; text?: string; error?: string }
  ): void {
    const session = this.session
    if (!session || session.id !== dictationId) {
      return
    }
    if (event.type === 'partial') {
      const partial = event.text ?? ''
      if (partial.trim().length === 0) {
        return
      }
      session.partialText = partial
      session.revision += 1
    } else if (event.type === 'final') {
      const text = event.text?.trim()
      if (text) {
        session.finalTexts.push(text)
        session.partialText = ''
        session.revision += 1
      }
    } else if (event.type === 'stopped') {
      session.state = 'closing'
    } else if (event.type === 'error') {
      session.errors.push(event.error ?? 'Speech worker error')
    }
  }

  private requireOwnedSession(params: {
    dictationId: string
    clientId?: string
    connectionId?: string
  }): MobileDictationSession {
    const session = this.session
    if (!session || session.id !== params.dictationId) {
      throw new Error('dictation_stream_not_started')
    }
    if (!params.clientId || session.clientId !== params.clientId) {
      throw new Error('dictation_owner_mismatch')
    }
    if (session.connectionId && session.connectionId !== params.connectionId) {
      throw new Error('dictation_owner_mismatch')
    }
    return session
  }

  private cancelSession(session: MobileDictationSession): void {
    if (session.state === 'closing') {
      return
    }
    session.state = 'closing'
    void getSpeechSttService(this.requireStore())
      .stopDictation(session.owner)
      .finally(() => {
        if (this.session?.id === session.id) {
          this.session = null
        }
      })
  }

  private requireStore(): RuntimeStore {
    const store = this.getStore()
    if (!store) {
      throw new Error('voice_dictation_unavailable')
    }
    return store
  }
}
