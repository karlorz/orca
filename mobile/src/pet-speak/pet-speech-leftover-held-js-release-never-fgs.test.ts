import { describe, expect, it } from 'vitest'
import { persistNotificationPlan } from './pet-speech-persist-write-decision'
import { isLeftoverHeld } from './pet-speech-leftover-held-tts-refuse'

describe('leftover-held JS_RELEASE never FGS', () => {
  it('fail-closed leftover-held overlay JS_RELEASE never starts FGS', () => {
    const leftoverHeldIdleAcquiring = {
      isSessionHeld: true,
      isAcquiring: true,
      connectedCount: 0
    }
    expect(isLeftoverHeld(leftoverHeldIdleAcquiring)).toBe(true)
    expect(persistNotificationPlan('JS_RELEASE').showFgs).toBe(false)
  })
})
