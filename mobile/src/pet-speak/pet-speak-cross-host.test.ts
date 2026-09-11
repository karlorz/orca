import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyOwnedPetSpeakCaption,
  claimPetSpeakEvent,
  releasePetSpeakEvent,
  resetPetSpeakCrossHostForTests
} from './pet-speak-cross-host'
import { getPetSpeakLiveCaption } from './pet-speak-live-caption'
import { PetSpeakHandler } from './pet-speak'
import type { MediaSessionAdapter, TtsAdapter } from './pet-speak-adapters'
import type { PetSpeakCaption } from './pet-speak-types'

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
  spoken: string[] = []
  async getAvailableVoices(): Promise<string[]> {
    return ['yue-HK']
  }
  async speak(text: string, _locale: string): Promise<void> {
    this.spoken.push(text)
    await new Promise((resolve) => setTimeout(resolve, 15))
  }
  async stop(): Promise<void> {}
}

class MockMediaSessionAdapter implements MediaSessionAdapter {
  async startSession(_text: string): Promise<string> {
    return 'session'
  }
  async stopSession(_sessionId: string): Promise<void> {}
}

describe('pet-speak cross-host ownership', () => {
  beforeEach(() => {
    resetPetSpeakCrossHostForTests()
  })

  it('lets the first host claim an event_id and rejects the second host', () => {
    expect(claimPetSpeakEvent('ev-1', 'host-a')).toBe(true)
    expect(claimPetSpeakEvent('ev-1', 'host-b')).toBe(false)
    expect(claimPetSpeakEvent('ev-1', 'host-a')).toBe(true)
  })

  it('does not let a late host play after the owner releases the event', () => {
    expect(claimPetSpeakEvent('ev-1', 'host-a')).toBe(true)
    releasePetSpeakEvent('ev-1', 'host-a')
    expect(claimPetSpeakEvent('ev-1', 'host-b')).toBe(false)
    expect(claimPetSpeakEvent('ev-1', 'host-a')).toBe(false)
  })

  it('ignores caption clear from a host that does not own the live overlay', () => {
    expect(claimPetSpeakEvent('ev-1', 'host-a')).toBe(true)
    expect(applyOwnedPetSpeakCaption({ eventId: 'ev-1', text: 'Keep me' }, 'host-a')).toBe(true)
    expect(getPetSpeakLiveCaption()?.text).toBe('Keep me')

    expect(applyOwnedPetSpeakCaption(null, 'host-b')).toBe(false)
    expect(getPetSpeakLiveCaption()?.text).toBe('Keep me')

    expect(applyOwnedPetSpeakCaption(null, 'host-a')).toBe(true)
    expect(getPetSpeakLiveCaption()).toBeNull()
  })

  it('proves loser event cannot wipe winner caption or paging state', () => {
    // Winner claims event and posts sentence caption
    expect(claimPetSpeakEvent('ev-win-1', 'host-winner')).toBe(true)
    expect(
      applyOwnedPetSpeakCaption({ eventId: 'ev-win-1', text: '第一句。第二句！' }, 'host-winner')
    ).toBe(true)
    expect(getPetSpeakLiveCaption()?.text).toBe('第一句。第二句！')

    // Loser host attempts to claim same event -> rejected
    expect(claimPetSpeakEvent('ev-win-1', 'host-loser')).toBe(false)
    // Loser host attempts to clear captions on its own nack/failure -> ignored
    expect(applyOwnedPetSpeakCaption(null, 'host-loser')).toBe(false)
    // Winner caption remains completely intact
    expect(getPetSpeakLiveCaption()?.text).toBe('第一句。第二句！')
  })
})

describe('PetSpeakHandler cross-host dedup', () => {
  beforeEach(() => {
    resetPetSpeakCrossHostForTests()
  })

  it('plays an event on the first host only and nacks the second without clearing captions', async () => {
    const ttsA = new MockTtsAdapter()
    const ttsB = new MockTtsAdapter()
    const captions: Array<PetSpeakCaption | null> = []
    const completed: Array<{ owner: string; eventId: string; outcome: string; reason?: string }> =
      []

    const hostA = new PetSpeakHandler({
      tts: ttsA,
      mediaSession: new MockMediaSessionAdapter(),
      nativeAdapter: null,
      crossHostOwnerId: 'host-a',
      onAccepted: async () => true,
      onCaption: (caption) => {
        captions.push(caption)
      },
      onComplete: async (eventId, outcome, reason) => {
        completed.push({ owner: 'host-a', eventId, outcome, reason })
      }
    })
    const hostB = new PetSpeakHandler({
      tts: ttsB,
      mediaSession: new MockMediaSessionAdapter(),
      nativeAdapter: null,
      crossHostOwnerId: 'host-b',
      onAccepted: async () => true,
      onCaption: (caption) => {
        captions.push(caption)
      },
      onComplete: async (eventId, outcome, reason) => {
        completed.push({ owner: 'host-b', eventId, outcome, reason })
      }
    })

    const payload = {
      type: 'pet.speak' as const,
      text: 'Only one host should speak',
      lang: 'yue-HK',
      event_id: 'ev-dual-1'
    }
    await Promise.all([hostA.handleEvent(payload), hostB.handleEvent(payload)])

    expect(ttsA.spoken).toEqual(['Only one host should speak'])
    expect(ttsB.spoken).toEqual([])
    expect(completed).toEqual([
      expect.objectContaining({ owner: 'host-a', eventId: 'ev-dual-1', outcome: 'spoken' })
    ])
    expect(completed.some((row) => row.reason === 'queue_replacement')).toBe(false)
    expect(captions.filter((caption) => caption === null)).toHaveLength(1)
    expect(captions.some((caption) => caption?.text === 'Only one host should speak')).toBe(true)
  })
})
