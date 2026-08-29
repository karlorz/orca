import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Speech from 'expo-speech'
import {
  resolvePetLocale,
  type TtsAdapter,
  type MediaSessionAdapter,
  DefaultTtsAdapter,
  PetSpeakHandler
} from './pet-speak'
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

describe('DefaultTtsAdapter', () => {
  let adapter: DefaultTtsAdapter

  beforeEach(() => {
    vi.clearAllMocks()
    adapter = new DefaultTtsAdapter()
  })

  it('queries expo-speech getAvailableVoicesAsync for available languages/locales and does NOT hardcode them', async () => {
    vi.mocked(Speech.getAvailableVoicesAsync).mockResolvedValue([
      {
        identifier: 'v1',
        name: 'Voice 1',
        language: 'en-US',
        quality: Speech.VoiceQuality.Default
      },
      {
        identifier: 'v2',
        name: 'Voice 2',
        language: 'yue-HK',
        quality: Speech.VoiceQuality.Default
      }
    ])

    const voices = await adapter.getAvailableVoices()
    expect(Speech.getAvailableVoicesAsync).toHaveBeenCalledTimes(1)
    expect(voices).toEqual(['en-US', 'yue-HK'])
  })

  it('returns empty array when expo-speech getAvailableVoicesAsync rejects (fails closed)', async () => {
    vi.mocked(Speech.getAvailableVoicesAsync).mockRejectedValue(new Error('TTS engine unavailable'))

    const voices = await adapter.getAvailableVoices()
    expect(voices).toEqual([])
  })

  it('invokes expo-speech speak with the exact target locale and resolves on done', async () => {
    vi.mocked(Speech.speak).mockImplementation((_text, options) => {
      options?.onDone?.()
    })

    await adapter.speak('你好', 'yue-HK')

    expect(Speech.speak).toHaveBeenCalledWith(
      '你好',
      expect.objectContaining({
        language: 'yue-HK'
      })
    )
  })

  it('rejects when expo-speech speak calls onError', async () => {
    vi.mocked(Speech.speak).mockImplementation((_text, options) => {
      options?.onError?.(new Error('Audio playback error'))
    })

    await expect(adapter.speak('你好', 'yue-HK')).rejects.toThrow('Audio playback error')
  })
})

describe('resolvePetLocale', () => {
  it('maps yue to yue-HK when available', () => {
    const available = ['en-US', 'yue-HK', 'zh-HK', 'zh-CN']
    expect(resolvePetLocale('yue', available)).toBe('yue-HK')
  })

  it('falls back to zh-HK if yue-HK is missing but zh-HK is available', () => {
    const available = ['en-US', 'zh-HK', 'zh-CN']
    expect(resolvePetLocale('yue', available)).toBe('zh-HK')
  })

  it('returns null (fails closed) if neither yue-HK nor zh-HK is available', () => {
    const available = ['en-US', 'zh-CN', 'zh-TW']
    expect(resolvePetLocale('yue', available)).toBeNull()
  })

  it('never falls back to en-US, zh-CN, or zh-TW for yue', () => {
    expect(resolvePetLocale('yue', ['en-US'])).toBeNull()
    expect(resolvePetLocale('yue', ['zh-CN'])).toBeNull()
    expect(resolvePetLocale('yue', ['zh-TW'])).toBeNull()
    expect(resolvePetLocale('yue', [])).toBeNull()
  })

  it('resolves zh-CN strictly to zh-CN and never falls back to zh-TW, zh-HK, yue, or en', () => {
    expect(resolvePetLocale('zh-CN', ['zh-CN', 'zh-TW', 'yue-HK', 'en-US'])).toBe('zh-CN')
    expect(resolvePetLocale('zh-cn', ['zh-CN'])).toBe('zh-CN')
    expect(resolvePetLocale('zh-CN', ['zh-TW', 'zh-HK', 'yue-HK', 'en-US'])).toBeNull()
  })

  it('resolves zh-TW strictly to zh-TW and never falls back to zh-CN, zh-HK, yue, or en', () => {
    expect(resolvePetLocale('zh-TW', ['zh-TW', 'zh-CN', 'yue-HK', 'en-US'])).toBe('zh-TW')
    expect(resolvePetLocale('zh-tw', ['zh-TW'])).toBe('zh-TW')
    expect(resolvePetLocale('zh-TW', ['zh-CN', 'zh-HK', 'yue-HK', 'en-US'])).toBeNull()
  })

  it('resolves en-US to en-US first, then to another installed en locale', () => {
    expect(resolvePetLocale('en-US', ['en-US', 'en-GB'])).toBe('en-US')
    expect(resolvePetLocale('en', ['en-GB', 'en-AU'])).toBe('en-GB')
    expect(resolvePetLocale('en-us', ['en-CA'])).toBe('en-CA')
    expect(resolvePetLocale('en-US', ['zh-CN', 'yue-HK', 'fr-FR'])).toBeNull()
  })

  it('handles default lang parameter when omitted or undefined (defaults to yue mapping)', () => {
    expect(resolvePetLocale(undefined, ['yue-HK'])).toBe('yue-HK')
    expect(resolvePetLocale(undefined, ['zh-HK'])).toBe('zh-HK')
    expect(resolvePetLocale(undefined, ['en-US'])).toBeNull()
  })
})

describe('PetSpeakHandler', () => {
  let mockTts: TtsAdapter
  let mockMediaSession: MediaSessionAdapter
  let handler: PetSpeakHandler

  beforeEach(() => {
    mockTts = {
      getAvailableVoices: vi.fn(async () => ['yue-HK', 'zh-HK']),
      speak: vi.fn(async (_text: string, _locale: string) => {})
    }
    mockMediaSession = {
      startSession: vi.fn(async (_text: string) => 'session-1'),
      stopSession: vi.fn(async (_sessionId: string) => {})
    }
    handler = new PetSpeakHandler({
      tts: mockTts,
      mediaSession: mockMediaSession
    })
  })

  it('plays text with yue-HK when available and wraps in short media session', async () => {
    await handler.handleEvent({
      type: 'pet.speak',
      text: '你好呀',
      lang: 'yue',
      event_id: 'evt-1'
    })

    expect(mockMediaSession.startSession).toHaveBeenCalledWith('你好呀')
    expect(mockTts.speak).toHaveBeenCalledWith('你好呀', 'yue-HK')
    expect(mockMediaSession.stopSession).toHaveBeenCalledWith('session-1')

    // Order check: startSession before speak, stopSession after speak
    const startOrder = vi.mocked(mockMediaSession.startSession).mock.invocationCallOrder[0]
    const speakOrder = vi.mocked(mockTts.speak).mock.invocationCallOrder[0]
    const stopOrder = vi.mocked(mockMediaSession.stopSession).mock.invocationCallOrder[0]
    expect(startOrder).toBeLessThan(speakOrder)
    expect(speakOrder).toBeLessThan(stopOrder)
  })

  it('falls back to zh-HK when yue-HK is missing', async () => {
    vi.mocked(mockTts.getAvailableVoices).mockResolvedValue(['zh-HK'])

    await handler.handleEvent({
      type: 'pet.speak',
      text: '食咗飯未',
      lang: 'yue',
      event_id: 'evt-2'
    })

    expect(mockMediaSession.startSession).toHaveBeenCalledWith('食咗飯未')
    expect(mockTts.speak).toHaveBeenCalledWith('食咗飯未', 'zh-HK')
    expect(mockMediaSession.stopSession).toHaveBeenCalledWith('session-1')
  })

  it('fails closed: missing yue-HK and zh-HK does not call speak, keeps text on short media session', async () => {
    vi.mocked(mockTts.getAvailableVoices).mockResolvedValue(['en-US', 'zh-CN', 'zh-TW'])

    await handler.handleEvent({
      type: 'pet.speak',
      text: '粵語語音缺失',
      lang: 'yue',
      event_id: 'evt-3'
    })

    expect(mockMediaSession.startSession).toHaveBeenCalledWith('粵語語音缺失')
    expect(mockTts.speak).not.toHaveBeenCalled()
    expect(mockMediaSession.stopSession).toHaveBeenCalledWith('session-1')
  })

  it('stops media session even if speak throws an error', async () => {
    vi.mocked(mockTts.speak).mockRejectedValue(new Error('TTS playback failed'))

    await expect(
      handler.handleEvent({
        type: 'pet.speak',
        text: '測試錯誤',
        lang: 'yue',
        event_id: 'evt-4'
      })
    ).resolves.not.toThrow()

    expect(mockMediaSession.startSession).toHaveBeenCalledWith('測試錯誤')
    expect(mockTts.speak).toHaveBeenCalledWith('測試錯誤', 'yue-HK')
    expect(mockMediaSession.stopSession).toHaveBeenCalledWith('session-1')
  })

  it('dedupes event_id: ignores second identical id', async () => {
    await handler.handleEvent({
      type: 'pet.speak',
      text: '你好呀',
      lang: 'yue',
      event_id: 'evt-dedup-1'
    })

    expect(mockTts.speak).toHaveBeenCalledTimes(1)
    expect(mockMediaSession.startSession).toHaveBeenCalledTimes(1)
    expect(mockMediaSession.stopSession).toHaveBeenCalledTimes(1)

    // Send exact same event_id again
    await handler.handleEvent({
      type: 'pet.speak',
      text: '你好呀',
      lang: 'yue',
      event_id: 'evt-dedup-1'
    })

    // Counts must not increment
    expect(mockTts.speak).toHaveBeenCalledTimes(1)
    expect(mockMediaSession.startSession).toHaveBeenCalledTimes(1)
    expect(mockMediaSession.stopSession).toHaveBeenCalledTimes(1)
  })

  it('ignores malformed / empty text payloads without calling speak or starting session', async () => {
    await handler.handleEvent({
      type: 'pet.speak',
      text: '',
      lang: 'yue',
      event_id: 'evt-empty'
    })
    expect(mockMediaSession.startSession).not.toHaveBeenCalled()
    expect(mockTts.speak).not.toHaveBeenCalled()

    await handler.handleEvent({
      type: 'pet.speak',
      text: '   ',
      lang: 'yue',
      event_id: 'evt-whitespace'
    } as unknown as Parameters<typeof handler.handleEvent>[0])
    expect(mockMediaSession.startSession).not.toHaveBeenCalled()
    expect(mockTts.speak).not.toHaveBeenCalled()

    await handler.handleEvent({
      type: 'pet.speak',
      lang: 'yue'
    } as unknown as Parameters<typeof handler.handleEvent>[0])
    expect(mockMediaSession.startSession).not.toHaveBeenCalled()
    expect(mockTts.speak).not.toHaveBeenCalled()

    await handler.handleEvent(null as unknown as Parameters<typeof handler.handleEvent>[0])
    expect(mockMediaSession.startSession).not.toHaveBeenCalled()
    expect(mockTts.speak).not.toHaveBeenCalled()
  })
})

describe('subscribeToPetSpeak', () => {
  it('subscribes to pet.speak.subscribe RPC and routes events to handler', async () => {
    let streamCallback: ((data: unknown) => void) | null = null
    const mockClient = {
      subscribe: vi.fn((_method: string, _params: unknown, cb: (data: unknown) => void) => {
        streamCallback = cb
        return () => {}
      }),
      sendRequest: vi.fn(async () => ({ ok: true })),
      getState: vi.fn(() => 'connected')
    } as unknown as RpcClient

    const mockTts: TtsAdapter = {
      getAvailableVoices: vi.fn(async () => ['yue-HK']),
      speak: vi.fn(async () => {})
    }
    const mockMediaSession: MediaSessionAdapter = {
      startSession: vi.fn(async () => 'sess-1'),
      stopSession: vi.fn(async () => {})
    }

    const unsubscribe = subscribeToPetSpeak(mockClient, {
      tts: mockTts,
      mediaSession: mockMediaSession
    })

    await new Promise((r) => setTimeout(r, 10))

    expect(mockClient.subscribe).toHaveBeenCalledWith(
      'pet.speak.subscribe',
      {},
      expect.any(Function)
    )

    // Emit ready
    streamCallback!({ type: 'ready', subscriptionId: 'sub-pet-1' })

    // Emit event
    streamCallback!({
      type: 'pet.speak',
      text: '收到語音',
      lang: 'yue',
      event_id: 'evt-sub-1'
    })

    // Allow async handler to run
    await new Promise((r) => setTimeout(r, 10))

    expect(mockMediaSession.startSession).toHaveBeenCalledWith('收到語音')
    expect(mockTts.speak).toHaveBeenCalledWith('收到語音', 'yue-HK')
    expect(mockMediaSession.stopSession).toHaveBeenCalledWith('sess-1')

    // Unsubscribe sends pet.speak.unsubscribe
    unsubscribe()
    expect(mockClient.sendRequest).toHaveBeenCalledWith('pet.speak.unsubscribe', {
      subscriptionId: 'sub-pet-1'
    })
  })
})
