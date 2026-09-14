import { describe, expect, it } from 'vitest'
import {
  leftoverHeldHonorMediaCommandCaptioning,
  leftoverHeldRefusesMediaCommandCaptioning
} from './pet-speech-leftover-held-media-captioning-refuse'

describe('leftover-held refuses media-command captioning', () => {
  it('fail-closed leftover-held never honors CAPTIONING', () => {
    const leftoverHeldIdleAcquiring = {
      isSessionHeld: true,
      isAcquiring: true,
      connectedCount: 0
    }
    expect(leftoverHeldHonorMediaCommandCaptioning(leftoverHeldIdleAcquiring)).toBe(false)
    expect(leftoverHeldRefusesMediaCommandCaptioning(leftoverHeldIdleAcquiring)).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandCaptioning({
        isSessionHeld: true,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandCaptioning({
        isSessionHeld: false,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(false)
  })
})
