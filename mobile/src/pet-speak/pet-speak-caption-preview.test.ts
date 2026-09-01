import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_PET_SPEAK_PREVIEW_TEXT,
  getPetSpeakCaptionPreview,
  hidePetSpeakCaptionPreview,
  showPetSpeakCaptionPreview,
  subscribePetSpeakCaptionPreview
} from './pet-speak-caption-preview'

describe('PetSpeakCaptionPreview Store', () => {
  beforeEach(() => {
    hidePetSpeakCaptionPreview()
  })

  it('initially has no preview caption', () => {
    expect(getPetSpeakCaptionPreview()).toBeNull()
  })

  it('showPetSpeakCaptionPreview notifies listeners with default text when omitted', () => {
    const listener = vi.fn()
    const unsub = subscribePetSpeakCaptionPreview(listener)

    showPetSpeakCaptionPreview()

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith({
      eventId: 'preview',
      text: DEFAULT_PET_SPEAK_PREVIEW_TEXT
    })
    expect(getPetSpeakCaptionPreview()).toEqual({
      eventId: 'preview',
      text: DEFAULT_PET_SPEAK_PREVIEW_TEXT
    })

    unsub()
  })

  it('showPetSpeakCaptionPreview accepts custom text', () => {
    const listener = vi.fn()
    const unsub = subscribePetSpeakCaptionPreview(listener)

    showPetSpeakCaptionPreview('自訂預覽字幕')

    expect(listener).toHaveBeenCalledWith({
      eventId: 'preview',
      text: '自訂預覽字幕'
    })
    expect(getPetSpeakCaptionPreview()).toEqual({
      eventId: 'preview',
      text: '自訂預覽字幕'
    })

    unsub()
  })

  it('hidePetSpeakCaptionPreview notifies null and clears store', () => {
    const listener = vi.fn()
    showPetSpeakCaptionPreview('測試')
    const unsub = subscribePetSpeakCaptionPreview(listener)

    hidePetSpeakCaptionPreview()

    expect(listener).toHaveBeenCalledWith(null)
    expect(getPetSpeakCaptionPreview()).toBeNull()

    unsub()
  })

  it('unsubscribing stops receiving updates', () => {
    const listener = vi.fn()
    const unsub = subscribePetSpeakCaptionPreview(listener)

    showPetSpeakCaptionPreview('第 1 次')
    expect(listener).toHaveBeenCalledTimes(1)

    unsub()
    showPetSpeakCaptionPreview('第 2 次')
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
