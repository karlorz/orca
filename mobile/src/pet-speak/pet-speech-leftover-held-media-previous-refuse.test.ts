import { describe, expect, it } from 'vitest'
import {
  leftoverHeldHonorMediaCommandPrevious,
  leftoverHeldRefusesMediaCommandPrevious
} from './pet-speech-leftover-held-media-previous-refuse'

describe('leftover-held refuses media-command previous', () => {
  it('fail-closed leftover-held never honors PREVIOUS', () => {
    const leftoverHeldIdleAcquiring = {
      isSessionHeld: true,
      isAcquiring: true,
      connectedCount: 0
    }
    expect(leftoverHeldHonorMediaCommandPrevious(leftoverHeldIdleAcquiring)).toBe(false)
    expect(leftoverHeldRefusesMediaCommandPrevious(leftoverHeldIdleAcquiring)).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandPrevious({
        isSessionHeld: true,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandPrevious({
        isSessionHeld: false,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(false)
  })
})
