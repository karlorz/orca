import { describe, expect, it } from 'vitest'
import {
  leftoverHeldHonorMediaCommandRating,
  leftoverHeldRefusesMediaCommandRating
} from './pet-speech-leftover-held-media-rating-refuse'

describe('leftover-held refuses media-command rating', () => {
  it('fail-closed leftover-held never honors RATING', () => {
    const leftoverHeldIdleAcquiring = {
      isSessionHeld: true,
      isAcquiring: true,
      connectedCount: 0
    }
    expect(leftoverHeldHonorMediaCommandRating(leftoverHeldIdleAcquiring)).toBe(false)
    expect(leftoverHeldRefusesMediaCommandRating(leftoverHeldIdleAcquiring)).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandRating({
        isSessionHeld: true,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandRating({
        isSessionHeld: false,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(false)
  })
})
