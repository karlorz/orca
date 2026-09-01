import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyPetSpeakCaptionRange,
  getPetSpeakCaptionRange,
  subscribePetSpeakCaptionRange
} from './pet-speak-caption-range'

describe('pet-speak-caption-range', () => {
  beforeEach(() => {
    applyPetSpeakCaptionRange(null)
  })

  it('notifies subscribers of the current engine range', () => {
    const listener = vi.fn()
    const unsub = subscribePetSpeakCaptionRange(listener)
    applyPetSpeakCaptionRange({ eventId: 'e1', start: 0, end: 2 })
    expect(getPetSpeakCaptionRange()).toEqual({ eventId: 'e1', start: 0, end: 2 })
    expect(listener).toHaveBeenCalledWith({ eventId: 'e1', start: 0, end: 2 })
    unsub()
  })
})
