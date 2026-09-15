import { describe, expect, it } from 'vitest'
import {
  leftoverHeldHonorMediaCommandShuffle,
  leftoverHeldRefusesMediaCommandShuffle
} from './pet-speech-leftover-held-media-shuffle-refuse'

describe('leftover-held refuses media-command shuffle', () => {
  it('fail-closed leftover-held never honors SHUFFLE', () => {
    const leftoverHeldIdleAcquiring = {
      isSessionHeld: true,
      isAcquiring: true,
      connectedCount: 0
    }
    expect(leftoverHeldHonorMediaCommandShuffle(leftoverHeldIdleAcquiring)).toBe(false)
    expect(leftoverHeldRefusesMediaCommandShuffle(leftoverHeldIdleAcquiring)).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandShuffle({
        isSessionHeld: true,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandShuffle({
        isSessionHeld: false,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(false)
  })
})
