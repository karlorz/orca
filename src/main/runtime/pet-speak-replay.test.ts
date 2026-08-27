import { describe, expect, it, vi } from 'vitest'
import { PetSpeakReplayBuffer, type ReplayablePetSpeakEvent } from './pet-speak-replay'
import type { PetSpeakEvent } from './pet-voice-relay'

describe('PetSpeakReplayBuffer', () => {
  it('assigns monotonic seq and epoch to recorded events', () => {
    const buffer = new PetSpeakReplayBuffer()
    const event1: PetSpeakEvent = { type: 'pet.speak', text: 'hello', event_id: 'ev-1', rate: 1.2 }
    const event2: PetSpeakEvent = { type: 'pet.speak', text: 'world', event_id: 'ev-2', rate: 1.2 }

    const recorded1 = buffer.record(event1)
    const recorded2 = buffer.record(event2)

    expect(recorded1.seq).toBe(1)
    expect(recorded1.epoch).toBe(buffer.epoch)
    expect(recorded1.event_id).toBe('ev-1')

    expect(recorded2.seq).toBe(2)
    expect(recorded2.epoch).toBe(buffer.epoch)
    expect(recorded2.event_id).toBe('ev-2')
  })

  it('replays missed events newer than last_seen_seq when epoch matches', () => {
    const buffer = new PetSpeakReplayBuffer()
    const e1: PetSpeakEvent = { type: 'pet.speak', text: 'one', event_id: 'ev-1', rate: 1.2 }
    const e2: PetSpeakEvent = { type: 'pet.speak', text: 'two', event_id: 'ev-2', rate: 1.2 }
    const e3: PetSpeakEvent = { type: 'pet.speak', text: 'three', event_id: 'ev-3', rate: 1.2 }

    buffer.record(e1)
    buffer.record(e2)
    buffer.record(e3)

    const missed = buffer.getMissedSince(1, buffer.epoch)
    expect(missed.map((e) => e.event_id)).toEqual(['ev-2', 'ev-3'])
    expect(missed.every((e) => e.replayed === true)).toBe(true)
  })

  it('drops events older than TTL (45s) on replay', () => {
    vi.useFakeTimers()
    try {
      const now = Date.now()
      vi.setSystemTime(now)

      const buffer = new PetSpeakReplayBuffer(50, 45_000)
      buffer.record({ type: 'pet.speak', text: 'stale', event_id: 'ev-stale', rate: 1.2 })

      // Advance time by 46 seconds
      vi.setSystemTime(now + 46_000)

      buffer.record({ type: 'pet.speak', text: 'fresh', event_id: 'ev-fresh', rate: 1.2 })

      const missed = buffer.getMissedSince(0, buffer.epoch)
      expect(missed.map((e) => e.event_id)).toEqual(['ev-fresh'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns empty replay list on epoch mismatch or missing epoch (stream live only)', () => {
    const buffer = new PetSpeakReplayBuffer()
    buffer.record({ type: 'pet.speak', text: 'msg', event_id: 'ev-1', rate: 1.2 })

    expect(buffer.getMissedSince(0, 'different-epoch')).toEqual([])
    expect(buffer.getMissedSince(0, undefined)).toEqual([])
  })

  it('bounds buffer capacity to max capacity (~50 events)', () => {
    const buffer = new PetSpeakReplayBuffer(3)
    buffer.record({ type: 'pet.speak', text: '1', event_id: 'ev-1', rate: 1.2 })
    buffer.record({ type: 'pet.speak', text: '2', event_id: 'ev-2', rate: 1.2 })
    buffer.record({ type: 'pet.speak', text: '3', event_id: 'ev-3', rate: 1.2 })
    buffer.record({ type: 'pet.speak', text: '4', event_id: 'ev-4', rate: 1.2 })

    expect(buffer.size).toBe(3)
    const missed = buffer.getMissedSince(0, buffer.epoch)
    expect(missed.map((e) => e.event_id)).toEqual(['ev-2', 'ev-3', 'ev-4'])
  })
})
