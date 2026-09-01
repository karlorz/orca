import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import {
  type TtsAdapter,
  type MediaSessionAdapter,
  type PetSpeechNativeAdapter,
  PetSpeakHandler
} from './pet-speak'
import { PetSpeakRootBridge } from './pet-speak-root-bridge'
import { RpcClientProvider } from '../transport/client-context'
import type { HostProfile } from '../transport/types'

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
  Platform: { OS: 'ios', Version: 18 },
  View: 'View',
  Text: 'Text',
  StyleSheet: {
    create: (styles: unknown) => styles
  }
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
      getAllKeys: vi.fn(async () => Array.from(store.keys())),
      clear: vi.fn(async () => {
        store.clear()
      })
    }
  }
})

vi.mock('./pet-speech-preferences', () => ({
  loadPetSpeechPreferences: vi.fn(async () => ({
    enabled: true,
    migrationCompleted: true,
    installUuid: 'test-uuid',
    rate: 1,
    captionsEnabled: false,
    voiceByLanguage: { 'yue-HK': 'yue-hk-x-yuc-local' }
  })),
  subscribePetSpeechPreferences: vi.fn((_listener) => {
    return () => {}
  })
}))

vi.mock('../notifications/notification-permissions', () => ({
  ensureNotificationPermissions: vi.fn(async () => true)
}))

const openHostLogicalClientMock = vi.fn()
const loadHostCatalogMock = vi.fn()

vi.mock('../transport/host-logical-client', () => ({
  openHostLogicalClient: (...args: unknown[]) => openHostLogicalClientMock(...args)
}))
vi.mock('../transport/host-store', () => ({
  loadHostCatalog: () => loadHostCatalogMock(),
  loadHosts: () => loadHostCatalogMock()
}))
vi.mock('../transport/connection-revival-triggers', () => ({
  subscribeConnectionRevivalTriggers: () => () => {}
}))

describe('PetSpeakHandler onCaption listener (TDD)', () => {
  let mockTts: TtsAdapter
  let mockMediaSession: MediaSessionAdapter
  let captions: Array<{ eventId: string; text: string } | null> = []

  beforeEach(() => {
    captions = []
    mockTts = {
      getAvailableVoices: vi.fn(async () => ['yue-HK', 'zh-HK']),
      speak: vi.fn(async (_text: string, _locale: string) => {
        await new Promise((r) => setTimeout(r, 20))
      })
    }
    mockMediaSession = {
      startSession: vi.fn(async (_text: string) => 'session-1'),
      stopSession: vi.fn(async (_sessionId: string) => {})
    }
  })

  it('shows caption when utterance starts playback and hides (null) on completion', async () => {
    const handler = new PetSpeakHandler({
      tts: mockTts,
      mediaSession: mockMediaSession,
      onCaption: (caption) => {
        captions.push(caption)
      }
    })

    await handler.handleEvent({
      type: 'pet.speak',
      text: '你好呀，這是一條測試語音',
      lang: 'yue',
      event_id: 'evt-cap-1'
    })

    expect(captions).toEqual([{ eventId: 'evt-cap-1', text: '你好呀，這是一條測試語音' }, null])
  })

  it('shows caption when nativeAdapter starts speak and hides on complete', async () => {
    const mockNativeAdapter: PetSpeechNativeAdapter = {
      speak: vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 20))
        return 'spoken'
      })
    }

    const handler = new PetSpeakHandler({
      nativeAdapter: mockNativeAdapter,
      onCaption: (caption) => {
        captions.push(caption)
      }
    })

    await handler.handleEvent({
      type: 'pet.speak',
      text: '原生語音字幕測試',
      lang: 'yue-HK',
      event_id: 'evt-cap-native-1'
    })

    expect(mockNativeAdapter.speak).toHaveBeenCalledTimes(1)
    expect(captions).toEqual([{ eventId: 'evt-cap-native-1', text: '原生語音字幕測試' }, null])
  })

  it('does NOT show caption for invalid payloads or duplicate event ids', async () => {
    const handler = new PetSpeakHandler({
      tts: mockTts,
      mediaSession: mockMediaSession,
      onCaption: (caption) => {
        captions.push(caption)
      }
    })

    await handler.handleEvent({
      type: 'pet.speak',
      text: '',
      lang: 'yue',
      event_id: 'evt-empty'
    })

    await handler.handleEvent({
      type: 'pet.speak',
      text: '有效語音',
      lang: 'yue',
      event_id: 'evt-valid-1'
    })

    // Duplicate event_id
    await handler.handleEvent({
      type: 'pet.speak',
      text: '有效語音',
      lang: 'yue',
      event_id: 'evt-valid-1'
    })

    expect(captions).toEqual([{ eventId: 'evt-valid-1', text: '有效語音' }, null])
  })

  it('does NOT show caption if voice is unavailable before playback starts', async () => {
    mockTts.getAvailableVoices = vi.fn(async () => ['en-US'])

    const handler = new PetSpeakHandler({
      tts: mockTts,
      mediaSession: mockMediaSession,
      onCaption: (caption) => {
        captions.push(caption)
      }
    })

    await handler.handleEvent({
      type: 'pet.speak',
      text: '無粵語語音',
      lang: 'yue',
      event_id: 'evt-unavail-1'
    })

    expect(captions).toEqual([])
  })

  it('does NOT show caption for queue-capacity overflow cancellations', async () => {
    mockTts.speak = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 100))
    })

    const handler = new PetSpeakHandler({
      tts: mockTts,
      mediaSession: mockMediaSession,
      maxQueueCapacity: 2,
      onCaption: (caption) => {
        captions.push(caption)
      }
    })

    const p1 = handler.handleEvent({
      type: 'pet.speak',
      text: '第一條',
      lang: 'yue-HK',
      event_id: 'evt-q-1'
    })
    const p2 = handler.handleEvent({
      type: 'pet.speak',
      text: '第二條',
      lang: 'yue-HK',
      event_id: 'evt-q-2'
    })
    const p3 = handler.handleEvent({
      type: 'pet.speak',
      text: '第三條溢出',
      lang: 'yue-HK',
      event_id: 'evt-q-3'
    })

    await Promise.all([p1, p2, p3])

    // Only evt-q-1 and evt-q-2 were played and showed captions; evt-q-3 was cancelled before play
    expect(captions).toEqual([
      { eventId: 'evt-q-1', text: '第一條' },
      null,
      { eventId: 'evt-q-2', text: '第二條' },
      null
    ])
  })

  it('hides (null) active caption when cancelled or disposed during playback', async () => {
    let speakStartedResolve!: () => void
    const speakStarted = new Promise<void>((resolve) => {
      speakStartedResolve = resolve
    })

    mockTts.speak = vi.fn(async () => {
      speakStartedResolve()
      await new Promise((r) => setTimeout(r, 100))
    })

    const handler = new PetSpeakHandler({
      tts: mockTts,
      mediaSession: mockMediaSession,
      onCaption: (caption) => {
        captions.push(caption)
      }
    })

    const p = handler.handleEvent({
      type: 'pet.speak',
      text: '中途取消語音',
      lang: 'yue',
      event_id: 'evt-cancel-cap-1'
    })

    await speakStarted
    expect(captions).toEqual([{ eventId: 'evt-cancel-cap-1', text: '中途取消語音' }])

    handler.cancelInFlightUtterance()
    await p

    expect(captions).toEqual([{ eventId: 'evt-cancel-cap-1', text: '中途取消語音' }, null])
  })
})

describe('PetSpeakRootBridge caption UI rendering (TDD)', () => {
  it('renders caption banner when pet speech event is playing and hides when done', async () => {
    const HOST_A: HostProfile = {
      id: 'host-a',
      name: 'Host A',
      endpoint: 'ws://127.0.0.1:6768',
      deviceToken: 'token-a',
      publicKeyB64: 'key-a',
      credentialStatus: 'valid',
      isConnectable: true,
      lastConnected: 100
    }

    const clientA = {
      sendRequest: vi.fn(),
      subscribe: vi.fn((_method: string, _params: unknown, _cb: unknown) => {
        return () => {}
      }),
      getState: () => 'connected',
      getReconnectAttempt: () => 0,
      getLastConnectedAt: () => null,
      getActivePath: () => 'lan',
      getPendingPath: () => null,
      isPairingRejected: () => false,
      onConnectionPathChange: () => () => {},
      onStateChange: () => () => {},
      close: () => {}
    }

    openHostLogicalClientMock.mockReturnValue(clientA)
    loadHostCatalogMock.mockResolvedValue([
      {
        id: HOST_A.id,
        name: HOST_A.name,
        endpoint: HOST_A.endpoint,
        publicKeyB64: HOST_A.publicKeyB64,
        credentialStatus: 'ready',
        profile: HOST_A,
        lastConnected: 100
      }
    ])

    let renderer: ReactTestRenderer | null = null
    await act(async () => {
      renderer = create(createElement(RpcClientProvider, null, createElement(PetSpeakRootBridge)))
      await Promise.resolve()
      await Promise.resolve()
    })

    // Bridge mounted, initially no caption banner rendered
    expect(renderer?.root.findAllByType('Text')).toHaveLength(0)

    await act(async () => {
      renderer?.update(
        createElement(
          RpcClientProvider,
          null,
          createElement(PetSpeakRootBridge, {
            captionsEnabled: false,
            caption: { eventId: 'evt-off', text: '不應該顯示' }
          })
        )
      )
      await Promise.resolve()
    })

    expect(renderer?.root.findAllByType('Text')).toHaveLength(0)

    await act(async () => {
      renderer?.update(
        createElement(
          RpcClientProvider,
          null,
          createElement(PetSpeakRootBridge, {
            captionsEnabled: true,
            caption: { eventId: 'evt-1', text: '測試字幕顯示' }
          })
        )
      )
      await Promise.resolve()
    })

    const textNodes = renderer?.root.findAllByType('Text')
    expect(textNodes?.length).toBe(1)
    expect(textNodes?.[0]?.props.children).toBe('測試字幕顯示')

    // Cleared caption
    await act(async () => {
      renderer?.update(
        createElement(
          RpcClientProvider,
          null,
          createElement(PetSpeakRootBridge, {
            caption: null
          })
        )
      )
      await Promise.resolve()
    })

    expect(renderer?.root.findAllByType('Text')).toHaveLength(0)
  })
})
