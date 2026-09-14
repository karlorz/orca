import { describe, expect, it } from 'vitest'
import {
  leftoverHeldHonorMediaCommandRepeat,
  leftoverHeldRefusesMediaCommandRepeat
} from './pet-speech-leftover-held-media-repeat-refuse'

describe('leftover-held refuses media-command repeat', () => {
  it('fail-closed leftover-held never honors REPEAT', () => {
    const leftoverHeldIdleAcquiring = {
      isSessionHeld: true,
      isAcquiring: true,
      connectedCount: 0
    }
    expect(leftoverHeldHonorMediaCommandRepeat(leftoverHeldIdleAcquiring)).toBe(false)
    expect(leftoverHeldRefusesMediaCommandRepeat(leftoverHeldIdleAcquiring)).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandRepeat({
        isSessionHeld: true,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandRepeat({
        isSessionHeld: false,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(false)
  })
})
