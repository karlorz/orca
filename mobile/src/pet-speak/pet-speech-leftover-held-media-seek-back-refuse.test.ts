import { describe, expect, it } from 'vitest'
import {
  leftoverHeldHonorMediaCommandSeekBack,
  leftoverHeldRefusesMediaCommandSeekBack
} from './pet-speech-leftover-held-media-seek-back-refuse'

describe('leftover-held refuses media-command SEEK-BACK', () => {
  it('fail-closed leftover-held never honors SEEK-BACK', () => {
    const leftoverHeldIdleAcquiring = {
      isSessionHeld: true,
      isAcquiring: true,
      connectedCount: 0
    }
    expect(leftoverHeldHonorMediaCommandSeekBack(leftoverHeldIdleAcquiring)).toBe(false)
    expect(leftoverHeldRefusesMediaCommandSeekBack(leftoverHeldIdleAcquiring)).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandSeekBack({
        isSessionHeld: true,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandSeekBack({
        isSessionHeld: false,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(false)
  })
})
