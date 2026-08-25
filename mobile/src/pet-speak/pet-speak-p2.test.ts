import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  resolvePetLocale,
  type TtsAdapter,
  type MediaSessionAdapter,
  PetSpeakHandler,
  isValidPetSpeakPayload
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

  it('subscribeToPetSpeak sends pet.speak.complete RPC over client connection when events resolve', async () => {
    const mockClient: RpcClient = {
      getState: vi.fn(() => 'connected'),
      sendRequest: vi.fn().mockResolvedValue({ ok: true }),
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

    expect(mockClient.sendRequest).toHaveBeenCalledWith('pet.speak.complete', {
      event_id: 'ev-rpc-1',
      outcome: 'spoken'
    })

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

    // 5. Non-Cantonese languages
    expect(
      isValidPetSpeakPayload({ type: 'pet.speak', text: 'Hello', lang: 'en-US', event_id: 'ev-3' })
    ).toBe(false)
    expect(
      isValidPetSpeakPayload({ type: 'pet.speak', text: '你好', lang: 'zh-CN', event_id: 'ev-4' })
    ).toBe(false)
    expect(
      isValidPetSpeakPayload({ type: 'pet.speak', text: '你好', lang: 'zh-TW', event_id: 'ev-5' })
    ).toBe(false)

    // Send malformed event through handler
    await handler.handleEvent({
      type: 'pet.speak',
      text: '   ',
      event_id: 'ev-bad-1'
    } as unknown as null)
    await handler.handleEvent({
      type: 'pet.speak',
      text: 'Hello',
      lang: 'en-US',
      event_id: 'ev-bad-2'
    })

    expect(mockTts.spoken.length).toBe(0)
    expect(completedOutcomes.length).toBe(0)
  })

  it('strictly resolves Cantonese locales and never falls back to en-US, zh-CN, or zh-TW', () => {
    expect(resolvePetLocale('yue', ['en-US', 'yue-HK', 'zh-HK'])).toBe('yue-HK')
    expect(resolvePetLocale('cantonese', ['zh-HK'])).toBe('zh-HK')
    expect(resolvePetLocale('zh-HK', ['zh-HK'])).toBe('zh-HK')
    expect(resolvePetLocale('yue-HK', ['yue-HK'])).toBe('yue-HK')

    // Non-Cantonese requested languages return null
    expect(resolvePetLocale('en-US', ['en-US'])).toBeNull()
    expect(resolvePetLocale('zh-CN', ['zh-CN'])).toBeNull()
    expect(resolvePetLocale('zh-TW', ['zh-TW'])).toBeNull()
    expect(resolvePetLocale('fr-FR', ['fr-FR'])).toBeNull()
  })
})
