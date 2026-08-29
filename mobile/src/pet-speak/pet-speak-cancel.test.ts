import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  Platform: { OS: 'android', Version: 34 }
}))

import { PetSpeakHandler } from './pet-speak'
import type { PetSpeakPayload } from './pet-speak-payload-validation'
import type { PetSpeechNativeAdapter } from './pet-speak-adapters'

describe('PetSpeakHandler in-flight cancellation and disposal', () => {
  let mockNativeAdapter: {
    speak: ReturnType<typeof vi.fn>
    stop: ReturnType<typeof vi.fn>
  }
  let completedOutcomes: { eventId: string; outcome: string }[] = []

  beforeEach(() => {
    completedOutcomes = []
    mockNativeAdapter = {
      speak: vi.fn(async (_payload: PetSpeakPayload) => {
        // simulate in-flight speech
        await new Promise((r) => setTimeout(r, 50))
        return 'spoken'
      }),
      stop: vi.fn(async () => {})
    }
  })

  it('cancelInFlightUtterance immediately settles active item as cancelled exactly once and marks it terminal', async () => {
    let speakPromiseResolve: () => void
    const speakStarted = new Promise<void>((resolve) => {
      speakPromiseResolve = resolve
    })

    mockNativeAdapter.speak = vi.fn(async (_payload: PetSpeakPayload) => {
      speakPromiseResolve()
      await new Promise((r) => setTimeout(r, 100))
      return 'spoken'
    })

    const handler = new PetSpeakHandler({
      nativeAdapter: mockNativeAdapter as unknown as PetSpeechNativeAdapter,
      onComplete: async (eventId, outcome) => {
        completedOutcomes.push({ eventId, outcome })
      }
    })

    const eventPromise = handler.handleEvent({
      type: 'pet.speak',
      text: '測試中斷語音',
      lang: 'yue-HK',
      event_id: 'ev-cancel-1'
    })

    await speakStarted

    // User disables pet speech mid-utterance
    handler.cancelInFlightUtterance()

    await eventPromise

    // Verify terminal cancelled outcome reported exactly once
    expect(completedOutcomes).toEqual([{ eventId: 'ev-cancel-1', outcome: 'cancelled' }])
    expect(mockNativeAdapter.stop).toHaveBeenCalledTimes(1)
  })

  it('dispose() stops native adapter and settles pending events as cancelled', async () => {
    const handler = new PetSpeakHandler({
      nativeAdapter: mockNativeAdapter as unknown as PetSpeechNativeAdapter,
      onComplete: async (eventId, outcome) => {
        completedOutcomes.push({ eventId, outcome })
      }
    })

    handler.dispose()

    await handler.handleEvent({
      type: 'pet.speak',
      text: '已停用事件',
      lang: 'yue-HK',
      event_id: 'ev-disposed-1'
    })

    expect(completedOutcomes).toEqual([{ eventId: 'ev-disposed-1', outcome: 'cancelled' }])
  })
})
