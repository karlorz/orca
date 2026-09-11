import type { PetSpeakCaption } from './pet-speak-types'
import { applyPetSpeakLiveCaption } from './pet-speak-live-caption'

const MAX_TRACKED_EVENTS = 256

type EventRecord = {
  ownerId: string
  settled: boolean
}

const events = new Map<string, EventRecord>()
const eventOrder: string[] = []
let captionOwnerId: string | null = null

function rememberEvent(eventId: string): void {
  if (events.has(eventId)) {
    return
  }
  eventOrder.push(eventId)
  while (eventOrder.length > MAX_TRACKED_EVENTS) {
    const evicted = eventOrder.shift()
    if (evicted) {
      events.delete(evicted)
    }
  }
}

export function resetPetSpeakCrossHostForTests(): void {
  events.clear()
  eventOrder.length = 0
  captionOwnerId = null
  applyPetSpeakLiveCaption(null)
}

export function claimPetSpeakEvent(eventId: string, ownerId: string): boolean {
  const existing = events.get(eventId)
  if (!existing) {
    rememberEvent(eventId)
    events.set(eventId, { ownerId, settled: false })
    return true
  }
  if (existing.settled) {
    return false
  }
  return existing.ownerId === ownerId
}

export function releasePetSpeakEvent(eventId: string, ownerId: string): void {
  const existing = events.get(eventId)
  if (!existing || existing.ownerId !== ownerId) {
    return
  }
  existing.settled = true
}

export function applyOwnedPetSpeakCaption(
  caption: PetSpeakCaption | null,
  ownerId: string
): boolean {
  if (caption) {
    const claimed = events.get(caption.eventId)
    if (claimed && claimed.ownerId !== ownerId) {
      return false
    }
    applyPetSpeakLiveCaption(caption)
    captionOwnerId = ownerId
    return true
  }

  if (captionOwnerId !== ownerId) {
    return false
  }
  applyPetSpeakLiveCaption(null)
  captionOwnerId = null
  return true
}
