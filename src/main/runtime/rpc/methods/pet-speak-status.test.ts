import { describe, expect, it, vi } from 'vitest'
import { ALL_RPC_METHODS } from './index'
import type { RpcMethod } from '../core'
import type { PetSpeechDeviceStatus } from '../../pet-speech-status-registry'

describe('pet.speak.status and pet.speak.subscribe status RPC', () => {
  it('registers pet.speak.status RPC method in ALL_RPC_METHODS', () => {
    const statusMethod = ALL_RPC_METHODS.find((m) => m.name === 'pet.speak.status') as RpcMethod
    expect(statusMethod).toBeDefined()
  })

  it('validates pet.speak.status params and delegates to runtime.handlePetSpeechStatus', async () => {
    const statusMethod = ALL_RPC_METHODS.find((m) => m.name === 'pet.speak.status') as RpcMethod
    const mockRuntime = {
      handlePetSpeechStatus: vi.fn().mockResolvedValue({ acknowledged: true })
    }

    const payload: PetSpeechDeviceStatus = {
      installUuid: 'uuid-1234',
      modelName: 'Pixel 8',
      enabled: true,
      availability: 'available',
      activeEngine: 'com.google.android.tts',
      supportedLanguages: ['yue-HK', 'en-US'],
      currentLanguage: 'yue-HK',
      selectedVoice: 'cmn-hk-x-f-local',
      rate: 1.2,
      lastOutcome: 'spoken'
    }

    const result = await statusMethod.handler(payload, {
      runtime: mockRuntime as unknown as Parameters<typeof statusMethod.handler>[1]['runtime'],
      connectionId: 'conn-mobile-1'
    })

    expect(mockRuntime.handlePetSpeechStatus).toHaveBeenCalledWith(payload, 'conn-mobile-1')
    expect(result).toEqual({ acknowledged: true })
  })

  it('accepts disabled/unavailable payload with minimal fields', async () => {
    const statusMethod = ALL_RPC_METHODS.find((m) => m.name === 'pet.speak.status') as RpcMethod
    const mockRuntime = {
      handlePetSpeechStatus: vi.fn().mockResolvedValue({ acknowledged: true })
    }

    const payload = {
      installUuid: 'uuid-disabled-1',
      modelName: 'Galaxy Tab',
      enabled: false,
      availability: 'disabled'
    }

    const result = await statusMethod.handler(payload, {
      runtime: mockRuntime as unknown as Parameters<typeof statusMethod.handler>[1]['runtime'],
      connectionId: 'conn-mobile-2'
    })

    expect(mockRuntime.handlePetSpeechStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        installUuid: 'uuid-disabled-1',
        modelName: 'Galaxy Tab',
        enabled: false,
        availability: 'disabled'
      }),
      'conn-mobile-2'
    )
    expect(result).toEqual({ acknowledged: true })
  })

  it('rejects pet.speak.status if installUuid or modelName is missing', () => {
    const statusMethod = ALL_RPC_METHODS.find((m) => m.name === 'pet.speak.status') as RpcMethod
    expect(statusMethod).toBeDefined()

    const statusParams = statusMethod.params
    expect(statusParams).toBeTruthy()

    expect(() =>
      statusParams!.parse({
        installUuid: '',
        modelName: 'Pixel 8',
        enabled: true,
        availability: 'available'
      })
    ).toThrow()

    expect(() =>
      statusParams!.parse({
        installUuid: 'uuid-1',
        modelName: '',
        enabled: true,
        availability: 'available'
      })
    ).toThrow()
  })

  it('allows pet.speak.subscribe ready message to accept additive status field optionally', () => {
    const subscribeMethod = ALL_RPC_METHODS.find(
      (m) => m.name === 'pet.speak.subscribe'
    ) as RpcMethod
    expect(subscribeMethod).toBeDefined()
    const subscribeParams = subscribeMethod.params
    expect(subscribeParams).toBeTruthy()
    // Subscribe params schema accepts last_seen_seq, epoch, and optional status
    expect(() =>
      subscribeParams!.parse({
        last_seen_seq: 1,
        epoch: 'ep-1',
        status: {
          installUuid: 'uuid-sub',
          modelName: 'Phone',
          enabled: true,
          availability: 'available'
        }
      })
    ).not.toThrow()

    // Old client without status is also valid (mixed-version compatibility)
    expect(() =>
      subscribeParams!.parse({
        last_seen_seq: 1,
        epoch: 'ep-1'
      })
    ).not.toThrow()

    // Completely empty params is also valid
    expect(() => subscribeParams!.parse({})).not.toThrow()
  })
})
