import { describe, expect, it } from 'vitest'
import {
  leftoverHeldHonorMediaCommandUnmute,
  leftoverHeldRefusesMediaCommandUnmute
} from './pet-speech-leftover-held-media-unmute-refuse'

describe('leftover-held refuses media-command unmute', () => {
  it('fail-closed leftover-held never honors UNMUTE', () => {
    const leftoverHeldIdleAcquiring = {
      isSessionHeld: true,
      isAcquiring: true,
      connectedCount: 0
    }
    expect(leftoverHeldHonorMediaCommandUnmute(leftoverHeldIdleAcquiring)).toBe(false)
    expect(leftoverHeldRefusesMediaCommandUnmute(leftoverHeldIdleAcquiring)).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandUnmute({
        isSessionHeld: true,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandUnmute({
        isSessionHeld: false,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(false)
  })
})
