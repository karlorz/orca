import { describe, expect, it } from 'vitest'
import {
  leftoverHeldHonorMediaCommandResume,
  leftoverHeldRefusesMediaCommandResume
} from './pet-speech-leftover-held-media-resume-refuse'

describe('leftover-held refuses media-command resume', () => {
  it('fail-closed leftover-held never honors RESUME', () => {
    const leftoverHeldIdleAcquiring = {
      isSessionHeld: true,
      isAcquiring: true,
      connectedCount: 0
    }
    expect(leftoverHeldHonorMediaCommandResume(leftoverHeldIdleAcquiring)).toBe(false)
    expect(leftoverHeldRefusesMediaCommandResume(leftoverHeldIdleAcquiring)).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandResume({
        isSessionHeld: true,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandResume({
        isSessionHeld: false,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(false)
  })
})
