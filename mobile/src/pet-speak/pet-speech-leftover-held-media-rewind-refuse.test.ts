import { describe, expect, it } from 'vitest'
import {
  leftoverHeldHonorMediaCommandRewind,
  leftoverHeldRefusesMediaCommandRewind
} from './pet-speech-leftover-held-media-rewind-refuse'

describe('leftover-held refuses media-command rewind', () => {
  it('fail-closed leftover-held never honors REWIND', () => {
    const leftoverHeldIdleAcquiring = {
      isSessionHeld: true,
      isAcquiring: true,
      connectedCount: 0
    }
    expect(leftoverHeldHonorMediaCommandRewind(leftoverHeldIdleAcquiring)).toBe(false)
    expect(leftoverHeldRefusesMediaCommandRewind(leftoverHeldIdleAcquiring)).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandRewind({
        isSessionHeld: true,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandRewind({
        isSessionHeld: false,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(false)
  })
})
