import { describe, expect, it } from 'vitest'
import {
  leftoverHeldHonorMediaCommandVolume,
  leftoverHeldRefusesMediaCommandVolume
} from './pet-speech-leftover-held-media-volume-refuse'

describe('leftover-held refuses media-command volume', () => {
  it('fail-closed leftover-held never honors VOLUME', () => {
    const leftoverHeldIdleAcquiring = {
      isSessionHeld: true,
      isAcquiring: true,
      connectedCount: 0
    }
    expect(leftoverHeldHonorMediaCommandVolume(leftoverHeldIdleAcquiring)).toBe(false)
    expect(leftoverHeldRefusesMediaCommandVolume(leftoverHeldIdleAcquiring)).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandVolume({
        isSessionHeld: true,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandVolume({
        isSessionHeld: false,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(false)
  })
})
