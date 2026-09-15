import { describe, expect, it } from 'vitest'
import {
  leftoverHeldHonorMediaCommandPause,
  leftoverHeldRefusesMediaCommandPause
} from './pet-speech-leftover-held-media-pause-refuse'

describe('leftover-held refuses media-command pause', () => {
  it('fail-closed leftover-held never honors PAUSE', () => {
    const leftoverHeldIdleAcquiring = {
      isSessionHeld: true,
      isAcquiring: true,
      connectedCount: 0
    }
    expect(leftoverHeldHonorMediaCommandPause(leftoverHeldIdleAcquiring)).toBe(false)
    expect(leftoverHeldRefusesMediaCommandPause(leftoverHeldIdleAcquiring)).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandPause({
        isSessionHeld: true,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandPause({
        isSessionHeld: false,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(false)
  })
})
