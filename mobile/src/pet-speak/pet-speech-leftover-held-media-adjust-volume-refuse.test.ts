import { describe, expect, it } from 'vitest'
import {
  leftoverHeldHonorMediaCommandAdjustVolume,
  leftoverHeldRefusesMediaCommandAdjustVolume
} from './pet-speech-leftover-held-media-adjust-volume-refuse'

describe('leftover-held refuses media-command ADJUST-VOLUME', () => {
  it('fail-closed leftover-held never honors ADJUST-VOLUME', () => {
    const leftoverHeldIdleAcquiring = {
      isSessionHeld: true,
      isAcquiring: true,
      connectedCount: 0
    }
    expect(leftoverHeldHonorMediaCommandAdjustVolume(leftoverHeldIdleAcquiring)).toBe(false)
    expect(leftoverHeldRefusesMediaCommandAdjustVolume(leftoverHeldIdleAcquiring)).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandAdjustVolume({
        isSessionHeld: true,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandAdjustVolume({
        isSessionHeld: false,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(false)
  })
})
