import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RuntimeMobileDictationController } from './runtime-mobile-dictation-controller'
import type { RuntimeStore } from './runtime-store-contract'
import * as speechRuntimeService from '../speech/speech-runtime-service'
import { MAC_SYSTEM_SPEECH_MODEL_ID } from '../../shared/voice-dictation-selection'

describe('RuntimeMobileDictationController', () => {
  let startDictationMock: ReturnType<typeof vi.fn>
  let stopDictationMock: ReturnType<typeof vi.fn>
  let feedAudioMock: ReturnType<typeof vi.fn>
  let eventSink: ((event: { type: string; text?: string; error?: string }) => void) | null

  beforeEach(() => {
    eventSink = null
    stopDictationMock = vi.fn().mockResolvedValue(undefined)
    feedAudioMock = vi.fn()
    startDictationMock = vi.fn(async (_modelId, sink) => {
      eventSink = sink
    })
    speechRuntimeService.setSpeechServiceFactories({
      createModelManager: () =>
        ({
          getModelState: vi.fn(async (id: string) => ({ id, status: 'ready' }))
        }) as unknown as speechRuntimeService.SpeechServiceFactories extends {
          createModelManager: (...args: unknown[]) => infer M
        }
          ? M
          : never,
      createSttService: () =>
        ({
          startDictation: startDictationMock,
          stopDictation: stopDictationMock,
          feedAudio: feedAudioMock
        }) as unknown as speechRuntimeService.SpeechServiceFactories extends {
          createSttService: (...args: unknown[]) => infer S
        }
          ? S
          : never
    })
  })

  it('uses mac-system-speech when useMacSpeech is on even if client passes no modelId', async () => {
    const mockStore = {
      getSettings: () => ({
        voice: {
          enabled: true,
          useMacSpeech: true,
          sttModel: 'whisper-base'
        }
      })
    } as unknown as RuntimeStore

    const controller = new RuntimeMobileDictationController(() => mockStore)
    const result = await controller.start({
      dictationId: 'd1',
      clientId: 'c1'
    })

    expect(result.modelId).toBe(MAC_SYSTEM_SPEECH_MODEL_ID)
    expect(startDictationMock).toHaveBeenCalledWith(
      MAC_SYSTEM_SPEECH_MODEL_ID,
      expect.any(Function),
      undefined,
      'mobile:d1'
    )
  })

  it('honors effectiveSttModel over catalog params.modelId when useMacSpeech is on', async () => {
    const mockStore = {
      getSettings: () => ({
        voice: {
          enabled: true,
          useMacSpeech: true,
          sttModel: 'whisper-base'
        }
      })
    } as unknown as RuntimeStore

    const controller = new RuntimeMobileDictationController(() => mockStore)
    const result = await controller.start({
      dictationId: 'd2',
      modelId: 'whisper-tiny',
      clientId: 'c1'
    })

    expect(result.modelId).toBe(MAC_SYSTEM_SPEECH_MODEL_ID)
    expect(startDictationMock).toHaveBeenCalledWith(
      MAC_SYSTEM_SPEECH_MODEL_ID,
      expect.any(Function),
      undefined,
      'mobile:d2'
    )
  })

  it('uses params.modelId or stored catalog sttModel when useMacSpeech is off', async () => {
    const mockStore = {
      getSettings: () => ({
        voice: {
          enabled: true,
          useMacSpeech: false,
          sttModel: 'whisper-base'
        }
      })
    } as unknown as RuntimeStore

    const controller = new RuntimeMobileDictationController(() => mockStore)
    const result = await controller.start({
      dictationId: 'd3',
      modelId: 'whisper-tiny',
      clientId: 'c1'
    })

    expect(result.modelId).toBe('whisper-tiny')
    expect(startDictationMock).toHaveBeenCalledWith(
      'whisper-tiny',
      expect.any(Function),
      undefined,
      'mobile:d3'
    )
  })

  it('honors client sending mac-system-speech explicitly as Mac speech', async () => {
    const mockStore = {
      getSettings: () => ({
        voice: {
          enabled: true,
          useMacSpeech: false,
          sttModel: 'whisper-base'
        }
      })
    } as unknown as RuntimeStore

    const controller = new RuntimeMobileDictationController(() => mockStore)
    const result = await controller.start({
      dictationId: 'd4',
      modelId: MAC_SYSTEM_SPEECH_MODEL_ID,
      clientId: 'c1'
    })

    expect(result.modelId).toBe(MAC_SYSTEM_SPEECH_MODEL_ID)
    expect(startDictationMock).toHaveBeenCalledWith(
      MAC_SYSTEM_SPEECH_MODEL_ID,
      expect.any(Function),
      undefined,
      'mobile:d4'
    )
  })

  it('keeps Apple pause-end text for finish and ignores later chunks', async () => {
    const mockStore = {
      getSettings: () => ({
        voice: {
          enabled: true,
          useMacSpeech: true,
          sttModel: ''
        }
      })
    } as unknown as RuntimeStore

    const controller = new RuntimeMobileDictationController(() => mockStore)
    await controller.start({
      dictationId: 'd5',
      clientId: 'c1'
    })
    eventSink?.({ type: 'final', text: '喂今日天氣好唔好' })
    eventSink?.({ type: 'stopped' })

    expect(() =>
      controller.feed({
        dictationId: 'd5',
        clientId: 'c1',
        audioBase64: Buffer.alloc(4).toString('base64'),
        sampleRate: 16000
      })
    ).not.toThrow()
    expect(feedAudioMock).not.toHaveBeenCalled()

    const finished = await controller.finish({
      dictationId: 'd5',
      clientId: 'c1'
    })
    expect(finished.text).toBe('喂今日天氣好唔好')
    expect(stopDictationMock).toHaveBeenCalledWith('mobile:d5')
  })
})
