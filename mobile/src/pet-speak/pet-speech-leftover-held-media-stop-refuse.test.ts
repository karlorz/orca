import { describe, expect, it } from 'vitest'
import {
  leftoverHeldHonorMediaCommandStop,
  leftoverHeldRefusesMediaCommandStop
} from './pet-speech-leftover-held-media-stop-refuse'

describe('leftover-held refuses media-command stop', () => {
  it('fail-closed leftover-held never honors STOP', () => {
    const leftoverHeldIdleAcquiring = {
      isSessionHeld: true,
      isAcquiring: true,
      connectedCount: 0
    }
    expect(leftoverHeldHonorMediaCommandStop(leftoverHeldIdleAcquiring)).toBe(false)
    expect(leftoverHeldRefusesMediaCommandStop(leftoverHeldIdleAcquiring)).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandStop({
        isSessionHeld: true,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandStop({
        isSessionHeld: false,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(false)
  })
})
