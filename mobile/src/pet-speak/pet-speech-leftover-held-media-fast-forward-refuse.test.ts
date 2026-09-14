import { describe, expect, it } from 'vitest'
import {
  leftoverHeldHonorMediaCommandFastForward,
  leftoverHeldRefusesMediaCommandFastForward
} from './pet-speech-leftover-held-media-fast-forward-refuse'

describe('leftover-held refuses media-command fast-forward', () => {
  it('fail-closed leftover-held never honors FAST-FORWARD', () => {
    const leftoverHeldIdleAcquiring = {
      isSessionHeld: true,
      isAcquiring: true,
      connectedCount: 0
    }
    expect(leftoverHeldHonorMediaCommandFastForward(leftoverHeldIdleAcquiring)).toBe(false)
    expect(leftoverHeldRefusesMediaCommandFastForward(leftoverHeldIdleAcquiring)).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandFastForward({
        isSessionHeld: true,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandFastForward({
        isSessionHeld: false,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(false)
  })
})
