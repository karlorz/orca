import { describe, expect, it } from 'vitest'
import {
  leftoverHeldHonorMediaCommandSkip,
  leftoverHeldRefusesMediaCommandSkip
} from './pet-speech-leftover-held-media-skip-refuse'

describe('leftover-held refuses media-command skip', () => {
  it('fail-closed leftover-held never honors SKIP', () => {
    const leftoverHeldIdleAcquiring = {
      isSessionHeld: true,
      isAcquiring: true,
      connectedCount: 0
    }
    expect(leftoverHeldHonorMediaCommandSkip(leftoverHeldIdleAcquiring)).toBe(false)
    expect(leftoverHeldRefusesMediaCommandSkip(leftoverHeldIdleAcquiring)).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandSkip({
        isSessionHeld: true,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandSkip({
        isSessionHeld: false,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(false)
  })
})
