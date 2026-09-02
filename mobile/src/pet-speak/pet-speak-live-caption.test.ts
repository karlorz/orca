import { describe, expect, it } from 'vitest'
import {
  applyPetSpeakLiveCaption,
  getPetSpeakLiveCaption,
  subscribePetSpeakLiveCaption
} from './pet-speak-live-caption'

describe('pet-speak-live-caption store', () => {
  it('stores and notifies listeners when live caption updates', () => {
    const received: Array<{ eventId: string; text: string } | null> = []
    const unsub = subscribePetSpeakLiveCaption((caption) => {
      received.push(caption ? { eventId: caption.eventId, text: caption.text } : null)
    })

    applyPetSpeakLiveCaption({ eventId: 'ev-1', text: '你好' })
    expect(getPetSpeakLiveCaption()).toEqual({ eventId: 'ev-1', text: '你好' })

    applyPetSpeakLiveCaption(null)
    expect(getPetSpeakLiveCaption()).toBeNull()

    unsub()
    applyPetSpeakLiveCaption({ eventId: 'ev-2', text: '世界' })
    expect(received).toEqual([{ eventId: 'ev-1', text: '你好' }, null])
  })
})
