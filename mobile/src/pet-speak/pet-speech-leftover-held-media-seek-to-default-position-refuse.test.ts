import { describe, expect, it } from 'vitest'
import {
  leftoverHeldHonorMediaCommandSeekToDefaultPosition,
  leftoverHeldRefusesMediaCommandSeekToDefaultPosition
} from './pet-speech-leftover-held-media-seek-to-default-position-refuse'

describe('leftover-held refuses media-command SEEK-TO-DEFAULT-POSITION', () => {
  it('fail-closed leftover-held never honors SEEK-TO-DEFAULT-POSITION', () => {
    const leftoverHeldIdleAcquiring = {
      isSessionHeld: true,
      isAcquiring: true,
      connectedCount: 0
    }
    expect(leftoverHeldHonorMediaCommandSeekToDefaultPosition(leftoverHeldIdleAcquiring)).toBe(
      false
    )
    expect(leftoverHeldRefusesMediaCommandSeekToDefaultPosition(leftoverHeldIdleAcquiring)).toBe(
      true
    )
    expect(
      leftoverHeldRefusesMediaCommandSeekToDefaultPosition({
        isSessionHeld: true,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandSeekToDefaultPosition({
        isSessionHeld: false,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(false)
  })
})
