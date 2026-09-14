import { describe, expect, it } from 'vitest'
import {
  leftoverHeldHonorMediaCommandPlayPause,
  leftoverHeldRefusesMediaCommandPlayPause
} from './pet-speech-leftover-held-media-play-pause-refuse'

describe('leftover-held refuses media-command play-pause', () => {
  it('fail-closed leftover-held never honors PLAY-PAUSE', () => {
    const leftoverHeldIdleAcquiring = {
      isSessionHeld: true,
      isAcquiring: true,
      connectedCount: 0
    }
    expect(leftoverHeldHonorMediaCommandPlayPause(leftoverHeldIdleAcquiring)).toBe(false)
    expect(leftoverHeldRefusesMediaCommandPlayPause(leftoverHeldIdleAcquiring)).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandPlayPause({
        isSessionHeld: true,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandPlayPause({
        isSessionHeld: false,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(false)
  })
})
