import type { PetSpeakCaption } from './pet-speak-types'

type LiveCaptionListener = (caption: PetSpeakCaption | null) => void

let currentLiveCaption: PetSpeakCaption | null = null
const liveCaptionListeners = new Set<LiveCaptionListener>()

export function getPetSpeakLiveCaption(): PetSpeakCaption | null {
  return currentLiveCaption
}

export function applyPetSpeakLiveCaption(caption: PetSpeakCaption | null): void {
  currentLiveCaption = caption
  for (const listener of liveCaptionListeners) {
    try {
      listener(caption)
    } catch {
      // ignore listener error
    }
  }
}

export function subscribePetSpeakLiveCaption(listener: LiveCaptionListener): () => void {
  liveCaptionListeners.add(listener)
  return () => {
    liveCaptionListeners.delete(listener)
  }
}
