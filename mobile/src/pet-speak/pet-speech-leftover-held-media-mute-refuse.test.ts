import { describe, expect, it } from 'vitest'
import {
  leftoverHeldHonorMediaCommandMute,
  leftoverHeldRefusesMediaCommandMute
} from './pet-speech-leftover-held-media-mute-refuse'

describe('leftover-held refuses media-command mute', () => {
  it('fail-closed leftover-held never honors MUTE', () => {
    const leftoverHeldIdleAcquiring = {
      isSessionHeld: true,
      isAcquiring: true,
      connectedCount: 0
    }
    expect(leftoverHeldHonorMediaCommandMute(leftoverHeldIdleAcquiring)).toBe(false)
    expect(leftoverHeldRefusesMediaCommandMute(leftoverHeldIdleAcquiring)).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandMute({
        isSessionHeld: true,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandMute({
        isSessionHeld: false,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(false)
  })
})
