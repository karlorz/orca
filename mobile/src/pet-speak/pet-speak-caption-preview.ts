import type { PetSpeakCaption } from './pet-speak-types'

export const DEFAULT_PET_SPEAK_PREVIEW_TEXT =
  'Live captions preview — drag, then release to save this position.'

type CaptionPreviewListener = (caption: PetSpeakCaption | null) => void

let currentPreview: PetSpeakCaption | null = null
const previewListeners = new Set<CaptionPreviewListener>()

export function getPetSpeakCaptionPreview(): PetSpeakCaption | null {
  return currentPreview
}

export function showPetSpeakCaptionPreview(text?: string): void {
  currentPreview = {
    eventId: 'preview',
    text: text ?? DEFAULT_PET_SPEAK_PREVIEW_TEXT
  }
  for (const listener of previewListeners) {
    try {
      listener(currentPreview)
    } catch {
      // ignore listener error
    }
  }
}

export function hidePetSpeakCaptionPreview(): void {
  currentPreview = null
  for (const listener of previewListeners) {
    try {
      listener(null)
    } catch {
      // ignore listener error
    }
  }
}

export function subscribePetSpeakCaptionPreview(listener: CaptionPreviewListener): () => void {
  previewListeners.add(listener)
  return () => {
    previewListeners.delete(listener)
  }
}
