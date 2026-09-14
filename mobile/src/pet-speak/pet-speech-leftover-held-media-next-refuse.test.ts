import { describe, expect, it } from 'vitest'
import {
  leftoverHeldHonorMediaCommandNext,
  leftoverHeldRefusesMediaCommandNext
} from './pet-speech-leftover-held-media-next-refuse'

describe('leftover-held refuses media-command next', () => {
  it('fail-closed leftover-held never honors NEXT', () => {
    const leftoverHeldIdleAcquiring = {
      isSessionHeld: true,
      isAcquiring: true,
      connectedCount: 0
    }
    expect(leftoverHeldHonorMediaCommandNext(leftoverHeldIdleAcquiring)).toBe(false)
    expect(leftoverHeldRefusesMediaCommandNext(leftoverHeldIdleAcquiring)).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandNext({
        isSessionHeld: true,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandNext({
        isSessionHeld: false,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(false)
  })
})
