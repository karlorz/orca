import { describe, expect, it } from 'vitest'
import { inspectPetSpeakPayload } from './pet-speak-payload-validation'

describe('inspectPetSpeakPayload', () => {
  it('fail-closed non pet.speak events are type, not spoken', () => {
    expect(inspectPetSpeakPayload(null)).toEqual({ ok: false, reason: 'type' })
    expect(inspectPetSpeakPayload({ type: 'pet.stop', text: 'Hello', event_id: 'ev-1' })).toEqual({
      ok: false,
      reason: 'type'
    })
  })

  it('fail-closed missing event_id is event_id', () => {
    expect(inspectPetSpeakPayload({ type: 'pet.speak', text: 'Hello' })).toEqual({
      ok: false,
      reason: 'event_id'
    })
  })

  it('fail-closed unknown lang is lang', () => {
    expect(
      inspectPetSpeakPayload({ type: 'pet.speak', text: 'Hello', event_id: 'ev-1', lang: 'fr-FR' })
    ).toEqual({ ok: false, reason: 'lang', event_id: 'ev-1' })
  })

  it('fail-closed non-boolean debug is debug', () => {
    expect(
      inspectPetSpeakPayload({ type: 'pet.speak', text: 'Hello', event_id: 'ev-1', debug: 'yes' })
    ).toEqual({ ok: false, reason: 'debug', event_id: 'ev-1' })
  })

  it('accepts a canonical pet.speak payload', () => {
    const decision = inspectPetSpeakPayload({
      type: 'pet.speak',
      text: 'Hello',
      event_id: 'ev-1',
      lang: 'en-US'
    })
    expect(decision.ok).toBe(true)
  })
})
