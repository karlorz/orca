import { beforeEach, describe, expect, it, vi } from 'vitest'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { loadPetSpeakWatermark, savePetSpeakWatermark } from './pet-speak-watermark'
import { subscribeToPetSpeak } from './pet-speak-subscription'
import type { RpcClient } from '../transport/rpc-client'

vi.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 'high' },
  setNotificationChannelAsync: vi.fn(),
  getPermissionsAsync: vi.fn(),
  requestPermissionsAsync: vi.fn(),
  scheduleNotificationAsync: vi.fn(),
  dismissNotificationAsync: vi.fn()
}))

vi.mock('expo-speech', () => ({
  VoiceQuality: { Default: 'Default', Enhanced: 'Enhanced' },
  getAvailableVoicesAsync: vi.fn(async () => []),
  speak: vi.fn(),
  stop: vi.fn(async () => {})
}))

vi.mock('react-native', () => ({
  Platform: { OS: 'ios', Version: 18 }
}))

vi.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>()
  return {
    default: {
      getItem: vi.fn(async (key: string) => store.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => {
        store.set(key, value)
      }),
      removeItem: vi.fn(async (key: string) => {
        store.delete(key)
      }),
      clear: vi.fn(async () => {
        store.clear()
      })
    }
  }
})

describe('PetSpeak Replay & Watermark (Phase C)', () => {
  beforeEach(async () => {
    await AsyncStorage.clear()
    vi.clearAllMocks()
  })

  it('persists and loads lastSeenSeq and epoch in AsyncStorage', async () => {
    const loadedEmpty = await loadPetSpeakWatermark('host-1')
    expect(loadedEmpty).toEqual({ seq: 0, epoch: null, stored: false })

    await savePetSpeakWatermark('host-1', { seq: 5, epoch: 'epoch-abc' })
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      'orca:petSpeakWatermark:host-1',
      JSON.stringify({ seq: 5, epoch: 'epoch-abc' })
    )

    const loaded = await loadPetSpeakWatermark('host-1')
    expect(loaded).toEqual({ seq: 5, epoch: 'epoch-abc', stored: true })
  })

  it('passes last_seen_seq and epoch on pet.speak.subscribe when watermark exists', async () => {
    await savePetSpeakWatermark('host-1', { seq: 7, epoch: 'epoch-xyz' })

    const mockClient = {
      getState: () => 'connected',
      subscribe: vi.fn(() => () => {}),
      sendRequest: vi.fn().mockResolvedValue({})
    } as unknown as RpcClient & { hostId?: string }
    ;(mockClient as { hostId: string }).hostId = 'host-1'

    const unsub = subscribeToPetSpeak(mockClient, undefined, 'host-1')
    // Give promise a tick to load watermark and call subscribe
    await new Promise((r) => setTimeout(r, 10))

    expect(mockClient.subscribe).toHaveBeenCalledWith(
      'pet.speak.subscribe',
      { last_seen_seq: 7, epoch: 'epoch-xyz' },
      expect.any(Function)
    )
    unsub()
  })

  it('updates watermark on every received pet.speak event', async () => {
    let streamCallback: ((data: unknown) => void) | null = null
    const mockClient = {
      getState: () => 'connected',
      subscribe: vi.fn((_method: string, _params: unknown, cb: (data: unknown) => void) => {
        streamCallback = cb
        return () => {}
      }),
      sendRequest: vi.fn().mockResolvedValue({})
    } as unknown as RpcClient & { hostId?: string }
    ;(mockClient as { hostId: string }).hostId = 'host-1'

    const unsub = subscribeToPetSpeak(mockClient, undefined, 'host-1')
    await new Promise((r) => setTimeout(r, 10))
    expect(streamCallback).toBeDefined()

    streamCallback!({ type: 'ready', subscriptionId: 'sub-1', epoch: 'epoch-new' })

    streamCallback!({
      type: 'pet.speak',
      text: 'hello',
      event_id: 'ev-1',
      rate: 1.2,
      seq: 1,
      epoch: 'epoch-new'
    })

    await new Promise((r) => setTimeout(r, 10))

    const watermark = await loadPetSpeakWatermark('host-1')
    expect(watermark.seq).toBe(1)
    expect(watermark.epoch).toBe('epoch-new')

    unsub()
  })

  it('deduplicates events by seq so the same seq is never spoken twice', async () => {
    let streamCallback: ((data: unknown) => void) | null = null
    const mockClient = {
      getState: () => 'connected',
      subscribe: vi.fn((_method: string, _params: unknown, cb: (data: unknown) => void) => {
        streamCallback = cb
        return () => {}
      }),
      sendRequest: vi.fn().mockResolvedValue({})
    } as unknown as RpcClient & { hostId?: string }
    ;(mockClient as { hostId: string }).hostId = 'host-1'

    const mockTts = {
      speak: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      getAvailableVoices: vi.fn().mockResolvedValue(['yue-HK'])
    }

    const unsub = subscribeToPetSpeak(mockClient, { tts: mockTts }, 'host-1')
    await new Promise((r) => setTimeout(r, 10))

    streamCallback!({
      type: 'pet.speak',
      text: 'first speech',
      lang: 'yue-HK',
      event_id: 'ev-1',
      rate: 1.2,
      seq: 10,
      epoch: 'epoch-1'
    })

    await new Promise((r) => setTimeout(r, 20))
    expect(mockTts.speak).toHaveBeenCalledTimes(1)

    // Send same seq again (e.g. from replay or redelivery)
    streamCallback!({
      type: 'pet.speak',
      text: 'duplicate speech',
      lang: 'yue-HK',
      event_id: 'ev-2',
      rate: 1.2,
      seq: 10,
      epoch: 'epoch-1'
    })

    await new Promise((r) => setTimeout(r, 20))
    expect(mockTts.speak).toHaveBeenCalledTimes(1)

    unsub()
  })

  it('logs one RN line per replayed event via console.log', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    let streamCallback: ((data: unknown) => void) | null = null
    const mockClient = {
      getState: () => 'connected',
      subscribe: vi.fn((_method: string, _params: unknown, cb: (data: unknown) => void) => {
        streamCallback = cb
        return () => {}
      }),
      sendRequest: vi.fn().mockResolvedValue({})
    } as unknown as RpcClient & { hostId?: string }
    ;(mockClient as { hostId: string }).hostId = 'host-1'

    const mockTts = {
      speak: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      getAvailableVoices: vi.fn().mockResolvedValue(['yue-HK'])
    }

    const unsub = subscribeToPetSpeak(mockClient, { tts: mockTts }, 'host-1')
    await new Promise((r) => setTimeout(r, 10))

    streamCallback!({
      type: 'pet.speak',
      text: 'replayed utterance',
      lang: 'yue-HK',
      event_id: 'ev-replayed',
      rate: 1.2,
      seq: 11,
      epoch: 'epoch-1',
      replayed: true
    })

    await new Promise((r) => setTimeout(r, 20))
    expect(consoleSpy).toHaveBeenCalledWith('[pet-speak] replayed', 11, 'ev-replayed')

    consoleSpy.mockRestore()
    unsub()
  })
})
