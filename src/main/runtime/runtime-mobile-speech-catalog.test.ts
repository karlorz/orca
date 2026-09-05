import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RuntimeMobileSpeechCatalog } from './runtime-mobile-speech-catalog'
import type { RuntimeStore } from './runtime-store-contract'
import * as speechRuntimeService from '../speech/speech-runtime-service'

describe('RuntimeMobileSpeechCatalog', () => {
  beforeEach(() => {
    speechRuntimeService.setSpeechServiceFactories({
      createModelManager: () =>
        ({
          getModelStates: async () => [
            {
              id: 'mac-system-speech',
              status: process.platform === 'darwin' ? 'ready' : 'unavailable'
            },
            { id: 'parakeet-tdt-0.6b-v3-int8', status: 'ready' }
          ],
          getModelState: async (id: string) => ({
            id,
            status:
              id === 'mac-system-speech'
                ? process.platform === 'darwin'
                  ? 'ready'
                  : 'unavailable'
                : 'ready'
          }),
          downloadModel: vi.fn()
        }) as unknown as speechRuntimeService.SpeechServiceFactories extends {
          createModelManager: (...args: unknown[]) => infer M
        }
          ? M
          : never,
      createSttService: () =>
        ({}) as unknown as speechRuntimeService.SpeechServiceFactories extends {
          createSttService: (...args: unknown[]) => infer S
        }
          ? S
          : never
    })
  })

  it('omits system provider from models list and reflects mac speech availability and selection', async () => {
    const originalPlatform = process.platform
    try {
      const mockStore = {
        getSettings: () => ({
          voice: {
            enabled: true,
            sttModel: 'parakeet-tdt-0.6b-v3-int8',
            useMacSpeech: true,
            dictationMode: 'toggle'
          }
        }),
        updateSettings: vi.fn()
      } as unknown as RuntimeStore

      const catalog = new RuntimeMobileSpeechCatalog(() => mockStore)

      // On darwin: list() omits mac-system-speech from models; macSpeechAvailable is true, useMacSpeech is true
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      const macList = await catalog.list()
      const macSystemModel = macList.models.find((m) => m.id === 'mac-system-speech')
      expect(macSystemModel).toBeUndefined()
      expect(macList.macSpeechAvailable).toBe(true)
      expect(macList.useMacSpeech).toBe(true)
      expect(macList.selectedModelId).toBe('parakeet-tdt-0.6b-v3-int8')

      // On linux: macSpeechAvailable is false
      Object.defineProperty(process, 'platform', { value: 'linux' })
      const linuxList = await catalog.list()
      const linuxSystemModel = linuxList.models.find((m) => m.id === 'mac-system-speech')
      expect(linuxSystemModel).toBeUndefined()
      expect(linuxList.macSpeechAvailable).toBe(false)
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform })
    }
  })

  it('configures useMacSpeech and rejects on non-Mac host', async () => {
    const originalPlatform = process.platform
    try {
      let voiceSettings = {
        enabled: true,
        sttModel: 'parakeet-tdt-0.6b-v3-int8',
        useMacSpeech: false,
        dictationMode: 'toggle' as const
      }
      const mockStore = {
        getSettings: () => ({
          voice: voiceSettings
        }),
        updateSettings: vi.fn().mockImplementation((updates: { voice?: typeof voiceSettings }) => {
          if (updates.voice) {
            voiceSettings = { ...voiceSettings, ...updates.voice }
          }
        })
      } as unknown as RuntimeStore

      const catalog = new RuntimeMobileSpeechCatalog(() => mockStore)

      // Non-Mac rejects useMacSpeech: true
      Object.defineProperty(process, 'platform', { value: 'linux' })
      await expect(catalog.configure({ useMacSpeech: true })).rejects.toThrow(
        'voice_model_unavailable_on_host'
      )
      // Old client sending modelId: 'mac-system-speech' on non-Mac also rejected
      await expect(catalog.configure({ modelId: 'mac-system-speech' })).rejects.toThrow(
        'voice_model_unavailable_on_host'
      )

      // Darwin succeeds configuring useMacSpeech: true and keeps catalog model as selectedModelId
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      const res = await catalog.configure({ useMacSpeech: true })
      expect(res.useMacSpeech).toBe(true)
      expect(res.selectedModelId).toBe('parakeet-tdt-0.6b-v3-int8')

      // Darwin handling legacy modelId: 'mac-system-speech' treats it as useMacSpeech: true and does not store id as sttModel
      await catalog.configure({ modelId: 'mac-system-speech' })
      expect(voiceSettings.useMacSpeech).toBe(true)
      expect(voiceSettings.sttModel).not.toBe('mac-system-speech')
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform })
    }
  })

  it('rejects downloading a system speech model with voice_model_not_downloadable', async () => {
    const mockStore = {
      getSettings: () => ({ voice: {} }),
      updateSettings: vi.fn()
    } as unknown as RuntimeStore

    const catalog = new RuntimeMobileSpeechCatalog(() => mockStore)

    await expect(catalog.download('mac-system-speech')).rejects.toThrow(
      'voice_model_not_downloadable'
    )
  })
})
