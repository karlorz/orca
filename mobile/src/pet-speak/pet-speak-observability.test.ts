import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type MediaSessionAdapter,
  type PetSpeechNativeAdapter,
  type TtsAdapter,
  PetSpeakHandler
} from './pet-speak'
import { subscribeToPetSpeak } from './pet-speak-subscription'
import type { RpcClient } from '../transport/rpc-client'
import type { PetSpeakPayload } from './pet-speak-payload-validation'
import type { PetSpeakBoundaryTimestamps, PetSpeakCancelReason } from './pet-speak-observability'

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

class MockTtsAdapter implements TtsAdapter {
  spoken: { text: string; locale: string }[] = []
  voices: string[] = ['yue-HK']
  speakDelayMs = 10

  async getAvailableVoices(): Promise<string[]> {
    return this.voices
  }

  async speak(text: string, locale: string): Promise<void> {
    this.spoken.push({ text, locale })
    await new Promise((resolve) => setTimeout(resolve, this.speakDelayMs))
  }

  async stop(): Promise<void> {}
}

class MockMediaSessionAdapter implements MediaSessionAdapter {
  async startSession(_text: string): Promise<string> {
    return 'session-1'
  }

  async stopSession(_sessionId: string): Promise<void> {}
}

describe('PetSpeakHandler Rec 4 observability', () => {
  let mockTts: MockTtsAdapter
  let mockMedia: MockMediaSessionAdapter
  let completions: {
    eventId: string
    outcome: string
    reason?: PetSpeakCancelReason
    timestamps?: PetSpeakBoundaryTimestamps
  }[]

  beforeEach(() => {
    mockTts = new MockTtsAdapter()
    mockMedia = new MockMediaSessionAdapter()
    completions = []
  })

  function captureComplete() {
    return async (
      eventId: string,
      outcome: string,
      reason?: PetSpeakCancelReason,
      timestamps?: PetSpeakBoundaryTimestamps
    ) => {
      completions.push({ eventId, outcome, reason, timestamps })
    }
  }

  it('stamps ordered mobile boundaries on a spoken event', async () => {
    const handler = new PetSpeakHandler({
      tts: mockTts,
      mediaSession: mockMedia,
      onAccepted: async () => true,
      onComplete: captureComplete()
    })

    const socketReceivedAt = Date.now() - 5
    await handler.handleEvent(
      {
        type: 'pet.speak',
        text: 'Boundary spoken',
        lang: 'yue-HK',
        event_id: 'ev-boundary-spoken'
      },
      { socketReceivedAt }
    )

    expect(completions).toHaveLength(1)
    const row = completions[0]!
    expect(row.outcome).toBe('spoken')
    expect(row.reason).toBeUndefined()
    const ts = row.timestamps
    expect(ts?.mobile_socket_receive).toBe(socketReceivedAt)
    expect(ts?.mobile_queue_admission).toBeGreaterThanOrEqual(socketReceivedAt)
    expect(ts?.acceptance_send).toBeGreaterThanOrEqual(ts!.mobile_queue_admission!)
    expect(ts?.playback_start).toBeGreaterThanOrEqual(ts!.acceptance_send!)
    expect(ts?.completion_send).toBeGreaterThanOrEqual(ts!.playback_start!)
    expect(ts?.cancellation_send).toBeUndefined()
  })

  it('codes capacity rejection without claiming admission', async () => {
    mockTts.speakDelayMs = 40
    const handler = new PetSpeakHandler({
      tts: mockTts,
      mediaSession: mockMedia,
      maxQueueCapacity: 1,
      onAccepted: async () => true,
      onComplete: captureComplete()
    })

    const first = handler.handleEvent({
      type: 'pet.speak',
      text: 'Keep the lane busy',
      lang: 'yue-HK',
      event_id: 'ev-capacity-keep'
    })
    await handler.handleEvent({
      type: 'pet.speak',
      text: 'Overflow',
      lang: 'yue-HK',
      event_id: 'ev-capacity-reject'
    })
    await first

    const overflow = completions.find((row) => row.eventId === 'ev-capacity-reject')
    expect(overflow).toMatchObject({
      outcome: 'cancelled',
      reason: 'capacity_rejection'
    })
    expect(overflow?.timestamps?.mobile_queue_admission).toBeUndefined()
    expect(overflow?.timestamps?.cancellation_send).toEqual(expect.any(Number))
  })

  it('codes disposed-handler rejection as background lifecycle', async () => {
    const handler = new PetSpeakHandler({
      tts: mockTts,
      mediaSession: mockMedia,
      onComplete: captureComplete()
    })
    handler.dispose()
    await handler.handleEvent({
      type: 'pet.speak',
      text: 'Already disposed',
      lang: 'yue-HK',
      event_id: 'ev-disposed-reject'
    })

    expect(completions).toEqual([
      expect.objectContaining({
        eventId: 'ev-disposed-reject',
        outcome: 'cancelled',
        reason: 'background_lifecycle'
      })
    ])
  })

  it('codes in-flight cancel as operator interruption', async () => {
    let started!: () => void
    const speakStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    const nativeAdapter = {
      speak: vi.fn(async (_payload: PetSpeakPayload) => {
        started()
        await new Promise((resolve) => setTimeout(resolve, 80))
        return 'spoken'
      }),
      stop: vi.fn(async () => {})
    }

    const handler = new PetSpeakHandler({
      nativeAdapter: nativeAdapter as unknown as PetSpeechNativeAdapter,
      onComplete: captureComplete()
    })
    const pending = handler.handleEvent({
      type: 'pet.speak',
      text: 'Interrupt me',
      lang: 'yue-HK',
      event_id: 'ev-operator-cancel'
    })
    await speakStarted
    handler.cancelInFlightUtterance()
    await pending

    expect(completions).toEqual([
      expect.objectContaining({
        eventId: 'ev-operator-cancel',
        outcome: 'cancelled',
        reason: 'operator_interruption'
      })
    ])
  })

  it('codes native cancelled playback as text-to-speech cancellation', async () => {
    const nativeAdapter = {
      speak: vi.fn(async () => 'cancelled'),
      stop: vi.fn(async () => {})
    }
    const handler = new PetSpeakHandler({
      nativeAdapter: nativeAdapter as unknown as PetSpeechNativeAdapter,
      onComplete: captureComplete()
    })
    await handler.handleEvent({
      type: 'pet.speak',
      text: 'Engine cancelled',
      lang: 'yue-HK',
      event_id: 'ev-tts-cancel'
    })

    expect(completions).toEqual([
      expect.objectContaining({
        eventId: 'ev-tts-cancel',
        outcome: 'cancelled',
        reason: 'tts_cancellation'
      })
    ])
  })

  it('codes admission timeout as receipt timeout and still advances the queue', async () => {
    const handler = new PetSpeakHandler({
      tts: mockTts,
      mediaSession: mockMedia,
      admissionTimeoutMs: 10,
      onAccepted: async (eventId) => {
        if (eventId === 'ev-receipt-timeout') {
          return await new Promise<boolean>(() => {})
        }
        return true
      },
      onComplete: captureComplete()
    })

    await Promise.all([
      handler.handleEvent({
        type: 'pet.speak',
        text: 'Never authorize',
        lang: 'yue-HK',
        event_id: 'ev-receipt-timeout'
      }),
      handler.handleEvent({
        type: 'pet.speak',
        text: 'Fresh after timeout',
        lang: 'yue-HK',
        event_id: 'ev-after-timeout'
      })
    ])

    expect(completions.find((row) => row.eventId === 'ev-receipt-timeout')).toMatchObject({
      outcome: 'cancelled',
      reason: 'receipt_timeout'
    })
    expect(completions.find((row) => row.eventId === 'ev-after-timeout')).toMatchObject({
      outcome: 'spoken'
    })
    expect(mockTts.spoken.map((row) => row.text)).toEqual(['Fresh after timeout'])
  })
})

describe('subscribeToPetSpeak Rec 4 observability', () => {
  let mockTts: MockTtsAdapter
  let mockMedia: MockMediaSessionAdapter

  beforeEach(() => {
    mockTts = new MockTtsAdapter()
    mockMedia = new MockMediaSessionAdapter()
  })

  function clientThatEmits(eventId: string, overrides: Partial<RpcClient> = {}): RpcClient {
    return {
      getState: vi.fn(() => 'connected'),
      sendRequest: vi.fn().mockResolvedValue({ ok: true }),
      subscribe: vi.fn((_channel: string, _params: unknown, onData: (ev: unknown) => void) => {
        setTimeout(() => {
          onData({ type: 'ready', subscriptionId: 'sub-obs' })
          onData({
            type: 'pet.speak',
            text: 'Observability event',
            lang: 'yue-HK',
            event_id: eventId
          })
        }, 0)
        return () => {}
      }),
      ...overrides
    } as unknown as RpcClient
  }

  it('codes disconnect rejection locally when the acceptance RPC cannot be sent', async () => {
    const seen: { eventId: string; outcome: string; reason?: PetSpeakCancelReason }[] = []
    const client = clientThatEmits('ev-disconnect-reject', {
      getState: vi.fn(() => 'disconnected'),
      sendRequest: vi.fn()
    })

    const unsub = subscribeToPetSpeak(client, {
      tts: mockTts,
      mediaSession: mockMedia,
      onComplete: async (eventId, outcome, reason) => {
        seen.push({ eventId, outcome, reason })
      }
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    unsub()

    expect(mockTts.spoken).toEqual([])
    expect(seen).toEqual([
      {
        eventId: 'ev-disconnect-reject',
        outcome: 'cancelled',
        reason: 'disconnection'
      }
    ])
    expect(client.sendRequest).not.toHaveBeenCalledWith(
      'pet.speak.complete',
      expect.objectContaining({ event_id: 'ev-disconnect-reject' })
    )
  })

  it('codes acceptance transport failure as transport teardown', async () => {
    const client = clientThatEmits('ev-transport-reject', {
      sendRequest: vi.fn().mockImplementation(async (method: string) => {
        if (method === 'pet.speak.accepted') {
          throw new Error('socket closed')
        }
        return { ok: true }
      })
    })

    const unsub = subscribeToPetSpeak(client, { tts: mockTts, mediaSession: mockMedia })
    await new Promise((resolve) => setTimeout(resolve, 20))
    unsub()

    expect(mockTts.spoken).toEqual([])
    expect(client.sendRequest).toHaveBeenCalledWith(
      'pet.speak.complete',
      expect.objectContaining({
        event_id: 'ev-transport-reject',
        outcome: 'cancelled',
        reason: 'transport_teardown'
      })
    )
  })

  it('forwards spoken completion with mobile boundary timestamps', async () => {
    const client = clientThatEmits('ev-spoken-trace', {
      sendRequest: vi.fn().mockImplementation(async (method: string, params: unknown) => {
        if (method === 'pet.speak.accepted') {
          return { accepted: true, event_id: (params as { event_id: string }).event_id }
        }
        return { ok: true }
      })
    })

    const unsub = subscribeToPetSpeak(client, { tts: mockTts, mediaSession: mockMedia })
    await new Promise((resolve) => setTimeout(resolve, 40))
    unsub()

    expect(client.sendRequest).toHaveBeenCalledWith(
      'pet.speak.accepted',
      expect.objectContaining({
        event_id: 'ev-spoken-trace',
        timestamps: expect.objectContaining({
          mobile_socket_receive: expect.any(Number),
          mobile_queue_admission: expect.any(Number),
          acceptance_send: expect.any(Number)
        })
      })
    )
    expect(client.sendRequest).toHaveBeenCalledWith(
      'pet.speak.complete',
      expect.objectContaining({
        event_id: 'ev-spoken-trace',
        outcome: 'spoken',
        timestamps: expect.objectContaining({
          playback_start: expect.any(Number),
          completion_send: expect.any(Number)
        })
      })
    )
  })
})
