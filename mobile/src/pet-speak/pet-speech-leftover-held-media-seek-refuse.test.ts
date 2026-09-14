import { describe, expect, it } from 'vitest'
import {
  leftoverHeldHonorMediaCommandSeek,
  leftoverHeldRefusesMediaCommandSeek
} from './pet-speech-leftover-held-media-seek-refuse'

describe('leftover-held refuses media-command seek', () => {
  it('fail-closed leftover-held never honors SEEK', () => {
    const leftoverHeldIdleAcquiring = {
      isSessionHeld: true,
      isAcquiring: true,
      connectedCount: 0
    }
    expect(leftoverHeldHonorMediaCommandSeek(leftoverHeldIdleAcquiring)).toBe(false)
    expect(leftoverHeldRefusesMediaCommandSeek(leftoverHeldIdleAcquiring)).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandSeek({
        isSessionHeld: true,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandSeek({
        isSessionHeld: false,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(false)
  })
})
