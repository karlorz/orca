import { randomUUID } from 'node:crypto'
import type { PetSpeakEvent } from './pet-voice-relay'

export type ReplayablePetSpeakEvent = PetSpeakEvent & {
  seq: number
  epoch: string
  replayed?: boolean
}

type StoredPetSpeakEvent = ReplayablePetSpeakEvent & {
  timestamp: number
}

const DEFAULT_CAPACITY = 50
const DEFAULT_TTL_MS = 45_000

export class PetSpeakReplayBuffer {
  private readonly capacity: number
  private readonly ttlMs: number
  private seq = 0
  private readonly buffer: StoredPetSpeakEvent[] = []
  private readonly epochId: string = randomUUID()

  constructor(capacity: number = DEFAULT_CAPACITY, ttlMs: number = DEFAULT_TTL_MS) {
    this.capacity = capacity
    this.ttlMs = ttlMs
  }

  get epoch(): string {
    return this.epochId
  }

  record(event: PetSpeakEvent): ReplayablePetSpeakEvent {
    const seq = ++this.seq
    const entry: StoredPetSpeakEvent = {
      ...event,
      seq,
      epoch: this.epochId,
      timestamp: Date.now()
    }
    this.buffer.push(entry)
    if (this.buffer.length > this.capacity) {
      this.buffer.splice(0, this.buffer.length - this.capacity)
    }
    return {
      ...event,
      seq,
      epoch: this.epochId
    }
  }

  getMissedSince(lastSeenSeq: number, epoch?: string): ReplayablePetSpeakEvent[] {
    if (!epoch || epoch !== this.epochId) {
      return []
    }
    if (lastSeenSeq >= this.seq) {
      return []
    }

    const cutoff = Date.now() - this.ttlMs
    return this.buffer
      .filter((entry) => entry.seq > lastSeenSeq && entry.timestamp >= cutoff)
      .map(({ timestamp: _ts, ...event }) => ({
        ...event,
        replayed: true
      }))
  }

  get size(): number {
    return this.buffer.length
  }
}
