export type PetSpeakCaptionRangeEvent = {
  eventId: string
  start: number
  end: number
}

type RangeListener = (range: PetSpeakCaptionRangeEvent | null) => void

let currentRange: PetSpeakCaptionRangeEvent | null = null
const listeners = new Set<RangeListener>()

export function getPetSpeakCaptionRange(): PetSpeakCaptionRangeEvent | null {
  return currentRange
}

export function applyPetSpeakCaptionRange(range: PetSpeakCaptionRangeEvent | null): void {
  currentRange = range
  for (const listener of listeners) {
    try {
      listener(range)
    } catch {
      // ignore listener error
    }
  }
}

export function subscribePetSpeakCaptionRange(listener: RangeListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
