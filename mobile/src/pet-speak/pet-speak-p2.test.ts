import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  resolvePetLocale,
  type TtsAdapter,
  type MediaSessionAdapter,
  PetSpeakHandler,
  isValidPetSpeakPayload
} from './pet-speak'
import { parsePetSpeakRate } from './pet-speak-payload-validation'
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

class MockTtsAdapter implements TtsAdapter {
  spoken: { text: string; locale: string }[] = []
  voices: string[] = ['yue-HK', 'zh-HK']
  speakDelayMs = 20
  shouldFail = false
  isSpeaking = false
  concurrentCount = 0
  maxConcurrent = 0
  onSpeakStart?: () => void

  async getAvailableVoices(): Promise<string[]> {
    return this.voices
  }

  async speak(text: string, locale: string): Promise<void> {
    this.spoken.push({ text, locale })
    this.concurrentCount++
    this.maxConcurrent = Math.max(this.maxConcurrent, this.concurrentCount)
    this.isSpeaking = true
    this.onSpeakStart?.()

    await new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        this.concurrentCount--
        this.isSpeaking = false
        if (this.shouldFail) {
          reject(new Error('Playback failure'))
        } else {
          resolve()
        }
      }, this.speakDelayMs)
    })
  }

  async stop(): Promise<void> {
    this.isSpeaking = false
  }
}

class MockMediaSessionAdapter implements MediaSessionAdapter {
  activeSessions: string[] = []
  sessionCount = 0

  async startSession(_text: string): Promise<string> {
    const id = `session-${++this.sessionCount}`
    this.activeSessions.push(id)
    return id
  }

  async stopSession(sessionId: string): Promise<void> {
    this.activeSessions = this.activeSessions.filter((s) => s !== sessionId)
  }
}

describe('PetSpeakHandler - Task P2 FIFO, Capacity, Deduplication, Completion RPC, Disposal', () => {
  let mockTts: MockTtsAdapter
  let mockMedia: MockMediaSessionAdapter
  let completedOutcomes: { event_id: string; outcome: string }[] = []
  let onComplete: (eventId: string, outcome: string) => Promise<void>

  beforeEach(() => {
    mockTts = new MockTtsAdapter()
    mockMedia = new MockMediaSessionAdapter()
    completedOutcomes = []
    onComplete = async (eventId, outcome) => {
      completedOutcomes.push({ event_id: eventId, outcome })
    }
  })

  it('expires a stalled admission and advances to the next FIFO item', async () => {
    const handler = new PetSpeakHandler({
      tts: mockTts,
      mediaSession: mockMedia,
      admissionTimeoutMs: 10,
      onAccepted: async (eventId) => {
        if (eventId === 'ev-stalled') {
          return await new Promise<boolean>(() => {})
        }
        return true
      },
      onComplete
    })

    const stalled = handler.handleEvent({
      type: 'pet.speak',
      text: 'Never authorize',
      lang: 'yue-HK',
      event_id: 'ev-stalled'
    })
    const fresh = handler.handleEvent({
      type: 'pet.speak',
      text: 'Fresh authorized event',
      lang: 'yue-HK',
      event_id: 'ev-fresh-after-stall'
    })

    await Promise.all([stalled, fresh])
    expect(mockTts.spoken.map((item) => item.text)).toEqual(['Fresh authorized event'])
  })

  it('disposal releases an item awaiting admission and late true cannot resurrect it', async () => {
    let resolveAdmission: ((accepted: boolean) => void) | undefined
    const admission = new Promise<boolean>((resolve) => {
      resolveAdmission = resolve
    })
    const handler = new PetSpeakHandler({
      tts: mockTts,
      mediaSession: mockMedia,
      admissionTimeoutMs: 10_000,
      onAccepted: async () => await admission,
      onComplete
    })

    const pending = handler.handleEvent({
      type: 'pet.speak',
      text: 'Disposed while waiting',
      lang: 'yue-HK',
      event_id: 'ev-disposed-admission'
    })
    await new Promise((resolve) => setTimeout(resolve, 5))
    handler.dispose()
    await pending
    resolveAdmission?.(true)
    await Promise.resolve()

    expect(mockTts.spoken).toEqual([])
  })

  it('contains the success-then-stall incident and plays the first fresh exact event once', async () => {
    const receiptAttempts: string[] = []
    const handler = new PetSpeakHandler({
      tts: mockTts,
      mediaSession: mockMedia,
      admissionTimeoutMs: 10,
      onAccepted: async (eventId) => {
        receiptAttempts.push(eventId)
        if (eventId === 'ev-b-212ms' || eventId === 'ev-stale-398ms') {
          return await new Promise<boolean>(() => {})
        }
        return true
      },
      onComplete
    })

    await handler.handleEvent({
      type: 'pet.speak',
      text: 'Event A succeeds',
      lang: 'yue-HK',
      event_id: 'ev-a-success'
    })
    await Promise.all([
      handler.handleEvent({
        type: 'pet.speak',
        text: 'Event B stalls after 212 milliseconds',
        lang: 'yue-HK',
        event_id: 'ev-b-212ms'
      }),
      handler.handleEvent({
        type: 'pet.speak',
        text: 'Stale event after 398 milliseconds',
        lang: 'yue-HK',
        event_id: 'ev-stale-398ms'
      }),
      handler.handleEvent({
        type: 'pet.speak',
        text: 'First fresh exact event',
        lang: 'yue-HK',
        event_id: 'ev-fresh-exact'
      })
    ])

    expect(receiptAttempts).toEqual([
      'ev-a-success',
      'ev-b-212ms',
      'ev-stale-398ms',
      'ev-fresh-exact'
    ])
    expect(mockTts.spoken.map((item) => item.text)).toEqual([
      'Event A succeeds',
      'First fresh exact event'
    ])
    expect(mockTts.spoken.filter((item) => item.text === 'First fresh exact event')).toHaveLength(1)
  })

  it('waits for exact admission before playback and drops a rejected event', async () => {
    let resolveAdmission: ((accepted: boolean) => void) | undefined
    const admission = new Promise<boolean>((resolve) => {
      resolveAdmission = resolve
    })
    const handler = new PetSpeakHandler({
      tts: mockTts,
      mediaSession: mockMedia,
      onAccepted: async () => await admission,
      onComplete
    })

    const pending = handler.handleEvent({
      type: 'pet.speak',
      text: 'Wait for receipt',
      lang: 'yue-HK',
      event_id: 'ev-wait-receipt'
    })
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(mockTts.spoken).toEqual([])

    resolveAdmission?.(true)
    await pending
    expect(mockTts.spoken.map((item) => item.text)).toEqual(['Wait for receipt'])

    const rejected = new PetSpeakHandler({
      tts: mockTts,
      mediaSession: mockMedia,
      onAccepted: async () => false,
      onComplete
    })
    await rejected.handleEvent({
      type: 'pet.speak',
      text: 'Stale event',
      lang: 'yue-HK',
      event_id: 'ev-stale-receipt'
    })
    expect(mockTts.spoken.map((item) => item.text)).not.toContain('Stale event')
  })

  it('reports queue admission exactly once before truthful completion', async () => {
    const lifecycle: string[] = []
    const handler = new PetSpeakHandler({
      tts: mockTts,
      mediaSession: mockMedia,
      onAccepted: async (eventId) => {
        lifecycle.push(`accepted:${eventId}`)
        return true
      },
      onComplete: async (eventId, outcome) => {
        lifecycle.push(`completed:${eventId}:${outcome}`)
      }
    })

    const event = {
      type: 'pet.speak' as const,
      text: 'Admission ordering',
      lang: 'yue-HK',
      event_id: 'ev-admission-order'
    }
    await Promise.all([handler.handleEvent(event), handler.handleEvent(event)])

    expect(lifecycle).toEqual([
      'accepted:ev-admission-order',
      'completed:ev-admission-order:spoken'
    ])
    expect(mockTts.spoken.map((item) => item.text)).toEqual(['Admission ordering'])
  })

  it('serializes rapid accepted events in FIFO order with max concurrent 1', async () => {
    mockTts.speakDelayMs = 25
    const handler = new PetSpeakHandler({
      tts: mockTts,
      mediaSession: mockMedia,
      onComplete
    })

    const p1 = handler.handleEvent({
      type: 'pet.speak',
      text: 'First event',
      lang: 'yue-HK',
      event_id: 'ev-1'
    })
    const p2 = handler.handleEvent({
      type: 'pet.speak',
      text: 'Second event',
      lang: 'yue-HK',
      event_id: 'ev-2'
    })
    const p3 = handler.handleEvent({
      type: 'pet.speak',
      text: 'Third event',
      lang: 'yue-HK',
      event_id: 'ev-3'
    })

    await Promise.all([p1, p2, p3])

    expect(mockTts.spoken.map((s) => s.text)).toEqual([
      'First event',
      'Second event',
      'Third event'
    ])
    expect(mockTts.maxConcurrent).toBe(1)
    expect(completedOutcomes).toEqual([
      { event_id: 'ev-1', outcome: 'spoken' },
      { event_id: 'ev-2', outcome: 'spoken' },
      { event_id: 'ev-3', outcome: 'spoken' }
    ])
  })

  it('bounds queue capacity to 16 and completes overflow events as cancelled immediately', async () => {
    mockTts.speakDelayMs = 50
    const handler = new PetSpeakHandler({
      tts: mockTts,
      mediaSession: mockMedia,
      onComplete
    })

    const promises: Promise<void>[] = []
    for (let i = 1; i <= 16; i++) {
      promises.push(
        handler.handleEvent({
          type: 'pet.speak',
          text: `Event ${i}`,
          lang: 'yue-HK',
          event_id: `ev-${i}`
        })
      )
    }

    const overflowPromise = handler.handleEvent({
      type: 'pet.speak',
      text: 'Overflow event',
      lang: 'yue-HK',
      event_id: 'ev-17'
    })

    await overflowPromise

    expect(completedOutcomes).toContainEqual({ event_id: 'ev-17', outcome: 'cancelled' })
    expect(mockTts.spoken.map((s) => s.text)).not.toContain('Overflow event')

    await Promise.all(promises)
    expect(mockTts.spoken.length).toBe(16)
  })

  it('deduplicates by event_id: duplicate before, during, and after playback yields one utterance', async () => {
    mockTts.speakDelayMs = 40
    const handler = new PetSpeakHandler({
      tts: mockTts,
      mediaSession: mockMedia,
      onComplete
    })

    const p1 = handler.handleEvent({
      type: 'pet.speak',
      text: 'Hello once',
      lang: 'yue-HK',
      event_id: 'ev-dup-1'
    })
    const p1Dupe = handler.handleEvent({
      type: 'pet.speak',
      text: 'Hello once',
      lang: 'yue-HK',
      event_id: 'ev-dup-1'
    })

    await Promise.all([p1, p1Dupe])

    expect(mockTts.spoken.length).toBe(1)
    expect(completedOutcomes.filter((c) => c.event_id === 'ev-dup-1').length).toBe(1)

    await handler.handleEvent({
      type: 'pet.speak',
      text: 'Hello once',
      lang: 'yue-HK',
      event_id: 'ev-dup-1'
    })
    expect(mockTts.spoken.length).toBe(1)
  })

  it('reports voice-unavailable outcome when no Cantonese locale is found', async () => {
    mockTts.voices = ['en-US', 'fr-FR']
    const handler = new PetSpeakHandler({
      tts: mockTts,
      mediaSession: mockMedia,
      onComplete
    })

    await handler.handleEvent({
      type: 'pet.speak',
      text: 'No cantonese',
      lang: 'yue-HK',
      event_id: 'ev-no-voice'
    })

    expect(mockTts.spoken.length).toBe(0)
    expect(completedOutcomes).toEqual([{ event_id: 'ev-no-voice', outcome: 'voice-unavailable' }])
  })

  it('reports playback-error outcome when TTS speak throws/fails', async () => {
    mockTts.shouldFail = true
    const handler = new PetSpeakHandler({
      tts: mockTts,
      mediaSession: mockMedia,
      onComplete
    })

    await handler.handleEvent({
      type: 'pet.speak',
      text: 'Error event',
      lang: 'yue-HK',
      event_id: 'ev-err'
    })

    expect(completedOutcomes).toEqual([{ event_id: 'ev-err', outcome: 'playback-error' }])
  })

  it('disposal cancels active and queued work with exact per-ID cancelled outcomes and is idempotent', async () => {
    mockTts.speakDelayMs = 60
    const handler = new PetSpeakHandler({
      tts: mockTts,
      mediaSession: mockMedia,
      onComplete
    })

    let activeStarted = false
    mockTts.onSpeakStart = () => {
      activeStarted = true
    }

    const p1 = handler.handleEvent({
      type: 'pet.speak',
      text: 'Active event',
      lang: 'yue-HK',
      event_id: 'ev-act'
    })
    const p2 = handler.handleEvent({
      type: 'pet.speak',
      text: 'Queued event 1',
      lang: 'yue-HK',
      event_id: 'ev-q1'
    })
    const p3 = handler.handleEvent({
      type: 'pet.speak',
      text: 'Queued event 2',
      lang: 'yue-HK',
      event_id: 'ev-q2'
    })

    while (!activeStarted) {
      await new Promise((r) => setTimeout(r, 5))
    }

    // Dispose once
    handler.dispose()
    // Repeated dispose should be idempotent and not emit duplicate cancellations
    handler.dispose()

    await Promise.all([p1, p2, p3])

    // Exact per-ID completion counts and outcomes: active and queued must be cancelled, never spoken
    expect(completedOutcomes).toEqual([
      { event_id: 'ev-q1', outcome: 'cancelled' },
      { event_id: 'ev-q2', outcome: 'cancelled' },
      { event_id: 'ev-act', outcome: 'cancelled' }
    ])
    expect(mockMedia.activeSessions.length).toBe(0)

    // Events sent to already-disposed handler: duplicate must not re-emit
    await handler.handleEvent({
      type: 'pet.speak',
      text: 'Late event',
      lang: 'yue-HK',
      event_id: 'ev-late'
    })
    await handler.handleEvent({
      type: 'pet.speak',
      text: 'Late event duplicate',
      lang: 'yue-HK',
      event_id: 'ev-late'
    })
    expect(completedOutcomes.filter((c) => c.event_id === 'ev-late')).toEqual([
      { event_id: 'ev-late', outcome: 'cancelled' }
    ])
  })

  it('subscription rejects playback when acceptance RPC rejects or the client disconnects', async () => {
    for (const mode of ['reject', 'disconnect'] as const) {
      const client: RpcClient = {
        getState: vi.fn(() => (mode === 'disconnect' ? 'disconnected' : 'connected')),
        sendRequest: vi.fn().mockImplementation(async (method: string) => {
          if (method === 'pet.speak.accepted') {
            throw new Error('acceptance unavailable')
          }
          return { ok: true }
        }),
        subscribe: vi.fn((_channel: string, _params: unknown, onData: (ev: unknown) => void) => {
          setTimeout(() => {
            onData({ type: 'ready', subscriptionId: `sub-${mode}` })
            onData({
              type: 'pet.speak',
              text: `Must not play ${mode}`,
              lang: 'yue-HK',
              event_id: `ev-${mode}`
            })
          }, 0)
          return () => {}
        })
      } as unknown as RpcClient
      const unsubscribe = subscribeToPetSpeak(client, { tts: mockTts, mediaSession: mockMedia })
      await new Promise((resolve) => setTimeout(resolve, 20))
      unsubscribe()
    }

    expect(mockTts.spoken).toEqual([])
  })

  it('subscribeToPetSpeak sends pet.speak.complete RPC over client connection when events resolve', async () => {
    const mockClient: RpcClient = {
      getState: vi.fn(() => 'connected'),
      sendRequest: vi.fn().mockImplementation(async (method: string, params: unknown) => {
        if (method === 'pet.speak.accepted') {
          return { accepted: true, event_id: (params as { event_id: string }).event_id }
        }
        return { ok: true }
      }),
      subscribe: vi.fn((channel: string, _params: unknown, onData: (ev: unknown) => void) => {
        if (channel === 'pet.speak.subscribe') {
          setTimeout(() => {
            onData({ type: 'ready', subscriptionId: 'sub-1' })
            onData({
              type: 'pet.speak',
              text: 'Test client speak',
              lang: 'yue-HK',
              event_id: 'ev-rpc-1'
            })
          }, 5)
        }
        return () => {}
      })
    } as unknown as RpcClient

    mockTts.speakDelayMs = 10
    const unsub = subscribeToPetSpeak(mockClient, {
      tts: mockTts,
      mediaSession: mockMedia
    })

    await new Promise((r) => setTimeout(r, 50))

    expect(mockClient.sendRequest).toHaveBeenCalledWith(
      'pet.speak.accepted',
      expect.objectContaining({
        event_id: 'ev-rpc-1'
      })
    )

    expect(mockClient.sendRequest).toHaveBeenCalledWith(
      'pet.speak.complete',
      expect.objectContaining({
        event_id: 'ev-rpc-1',
        outcome: 'spoken'
      })
    )
    const calls = vi.mocked(mockClient.sendRequest).mock.calls
    const acceptedIndex = calls.findIndex(([method]) => method === 'pet.speak.accepted')
    const completedIndex = calls.findIndex(([method]) => method === 'pet.speak.complete')
    expect(acceptedIndex).toBeGreaterThanOrEqual(0)
    expect(completedIndex).toBeGreaterThan(acceptedIndex)

    unsub()
  })

  it('strictly validates mobile trust boundary and rejects malformed inputs without playback or completion', async () => {
    const handler = new PetSpeakHandler({
      tts: mockTts,
      mediaSession: mockMedia,
      onComplete
    })

    // 1. Missing or empty event_id
    expect(isValidPetSpeakPayload({ type: 'pet.speak', text: 'Hello', event_id: '' })).toBe(false)
    expect(isValidPetSpeakPayload({ type: 'pet.speak', text: 'Hello' })).toBe(false)

    // 2. Overlong event_id (>128 unicode chars)
    expect(
      isValidPetSpeakPayload({ type: 'pet.speak', text: 'Hello', event_id: 'a'.repeat(129) })
    ).toBe(false)

    // 3. Empty or whitespace text
    expect(isValidPetSpeakPayload({ type: 'pet.speak', text: '   ', event_id: 'ev-1' })).toBe(false)

    // 4. Overlong text (>70 unicode chars)
    const longText = '這是一段很長很長的廣東話句子測試超過七十個字符的文字內容。'.repeat(3)
    expect(isValidPetSpeakPayload({ type: 'pet.speak', text: longText, event_id: 'ev-2' })).toBe(
      false
    )

    // 5. Accepted canonical and legacy languages
    expect(
      isValidPetSpeakPayload({ type: 'pet.speak', text: 'Hello', lang: 'en-US', event_id: 'ev-3' })
    ).toBe(true)
    expect(
      isValidPetSpeakPayload({ type: 'pet.speak', text: '你好', lang: 'zh-CN', event_id: 'ev-4' })
    ).toBe(true)
    expect(
      isValidPetSpeakPayload({ type: 'pet.speak', text: '你好', lang: 'zh-TW', event_id: 'ev-5' })
    ).toBe(true)
    expect(
      isValidPetSpeakPayload({ type: 'pet.speak', text: 'Hello', lang: 'en', event_id: 'ev-6' })
    ).toBe(true)
    expect(
      isValidPetSpeakPayload({ type: 'pet.speak', text: 'Hello', lang: 'fr-FR', event_id: 'ev-7' })
    ).toBe(false)

    // Optional rate must not reject an otherwise valid Cantonese payload
    expect(
      isValidPetSpeakPayload({
        type: 'pet.speak',
        text: '你好',
        lang: 'yue',
        event_id: 'ev-rate',
        rate: 1.2
      })
    ).toBe(true)
    expect(parsePetSpeakRate(undefined)).toBe(1.2)
    expect(parsePetSpeakRate(2)).toBe(2)
    expect(parsePetSpeakRate(99)).toBe(2.5)
    expect(parsePetSpeakRate(0.1)).toBe(0.5)

    // Send malformed event through handler
    await handler.handleEvent({
      type: 'pet.speak',
      text: '   ',
      event_id: 'ev-bad-1'
    } as unknown as null)
    await handler.handleEvent({
      type: 'pet.speak',
      text: 'Hello',
      lang: 'fr-FR',
      event_id: 'ev-bad-2'
    })

    expect(mockTts.spoken.length).toBe(0)
    expect(completedOutcomes.length).toBe(0)
  })

  it('strictly resolves locales within the same semantic language and fails closed', () => {
    // Cantonese: yue-HK, then zh-HK
    expect(resolvePetLocale('yue', ['en-US', 'yue-HK', 'zh-HK'])).toBe('yue-HK')
    expect(resolvePetLocale('cantonese', ['zh-HK'])).toBe('zh-HK')
    expect(resolvePetLocale('zh-HK', ['zh-HK'])).toBe('zh-HK')
    expect(resolvePetLocale('yue-HK', ['yue-HK'])).toBe('yue-HK')

    // Mandarin zh-CN: zh-CN only
    expect(resolvePetLocale('zh-CN', ['zh-CN'])).toBe('zh-CN')
    expect(resolvePetLocale('zh-CN', ['zh-TW'])).toBeNull()
    expect(resolvePetLocale('zh-CN', ['zh-HK'])).toBeNull()
    expect(resolvePetLocale('zh-CN', ['yue-HK'])).toBeNull()
    expect(resolvePetLocale('zh-CN', ['en-US'])).toBeNull()

    // Mandarin zh-TW: zh-TW only
    expect(resolvePetLocale('zh-TW', ['zh-TW'])).toBe('zh-TW')
    expect(resolvePetLocale('zh-TW', ['zh-CN'])).toBeNull()
    expect(resolvePetLocale('zh-TW', ['zh-HK'])).toBeNull()
    expect(resolvePetLocale('zh-TW', ['yue-HK'])).toBeNull()
    expect(resolvePetLocale('zh-TW', ['en-US'])).toBeNull()

    // English en-US: en-US, then other en locales
    expect(resolvePetLocale('en-US', ['en-US'])).toBe('en-US')
    expect(resolvePetLocale('en', ['en-GB'])).toBe('en-GB')
    expect(resolvePetLocale('en-US', ['en-AU', 'en-GB'])).toBe('en-AU')
    expect(resolvePetLocale('en-US', ['zh-CN', 'yue-HK'])).toBeNull()

    // Non-supported languages fail closed
    expect(resolvePetLocale('fr-FR', ['fr-FR'])).toBeNull()
    expect(resolvePetLocale('ja-JP', ['ja-JP'])).toBeNull()
  })
})
