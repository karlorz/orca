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
  it('passes system provider through and reflects availability and mac-only reason', async () => {
    const originalPlatform = process.platform
    try {
      const mockStore = {
        getSettings: () => ({
          voice: {
            enabled: true,
            sttModel: 'mac-system-speech',
            dictationMode: 'toggle'
          }
        }),
        updateSettings: vi.fn()
      } as unknown as RuntimeStore

      const catalog = new RuntimeMobileSpeechCatalog(() => mockStore)

      // On darwin: mac-system-speech should be ready without unavailableReason
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      const macList = await catalog.list()
      const macSystemModel = macList.models.find((m) => m.id === 'mac-system-speech')
      expect(macSystemModel).toBeDefined()
      expect(macSystemModel?.provider).toBe('system')
      expect(macSystemModel?.status).toBe('ready')
      expect(macSystemModel?.unavailableReason).toBeUndefined()

      // On linux: mac-system-speech should be unavailable with unavailableReason: 'mac-only'
      Object.defineProperty(process, 'platform', { value: 'linux' })
      const linuxList = await catalog.list()
      const linuxSystemModel = linuxList.models.find((m) => m.id === 'mac-system-speech')
      expect(linuxSystemModel).toBeDefined()
      expect(linuxSystemModel?.provider).toBe('system')
      expect(linuxSystemModel?.status).toBe('unavailable')
      expect(linuxSystemModel?.unavailableReason).toBe('mac-only')
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform })
    }
  })

  it('rejects configure selecting system speech model on non-Mac host', async () => {
    const originalPlatform = process.platform
    try {
      let voiceSettings = {
        enabled: true,
        sttModel: 'parakeet-tdt-0.6b-v3-int8',
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

      Object.defineProperty(process, 'platform', { value: 'linux' })
      await expect(catalog.configure({ modelId: 'mac-system-speech' })).rejects.toThrow(
        'voice_model_unavailable_on_host'
      )
      expect(mockStore.updateSettings).not.toHaveBeenCalled()

      // Still rejects unknown model ids with voice_model_unknown
      await expect(catalog.configure({ modelId: 'non-existent-model' })).rejects.toThrow(
        'voice_model_unknown'
      )

      // Succeeds on darwin
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      await expect(catalog.configure({ modelId: 'mac-system-speech' })).resolves.toMatchObject({
        selectedModelId: 'mac-system-speech'
      })
      expect(mockStore.updateSettings).toHaveBeenCalled()
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
