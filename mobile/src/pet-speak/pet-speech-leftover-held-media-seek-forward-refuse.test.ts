import { describe, expect, it } from 'vitest'
import {
  leftoverHeldHonorMediaCommandSeekForward,
  leftoverHeldRefusesMediaCommandSeekForward
} from './pet-speech-leftover-held-media-seek-forward-refuse'

describe('leftover-held refuses media-command SEEK-FORWARD', () => {
  it('fail-closed leftover-held never honors SEEK-FORWARD', () => {
    const leftoverHeldIdleAcquiring = {
      isSessionHeld: true,
      isAcquiring: true,
      connectedCount: 0
    }
    expect(leftoverHeldHonorMediaCommandSeekForward(leftoverHeldIdleAcquiring)).toBe(false)
    expect(leftoverHeldRefusesMediaCommandSeekForward(leftoverHeldIdleAcquiring)).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandSeekForward({
        isSessionHeld: true,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandSeekForward({
        isSessionHeld: false,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(false)
  })
})
