import { describe, expect, it } from 'vitest'
import {
  leftoverHeldHonorMediaCommandPlaybackSpeed,
  leftoverHeldRefusesMediaCommandPlaybackSpeed
} from './pet-speech-leftover-held-media-playback-speed-refuse'

describe('leftover-held refuses media-command playback-speed', () => {
  it('fail-closed leftover-held never honors PLAYBACK-SPEED', () => {
    const leftoverHeldIdleAcquiring = {
      isSessionHeld: true,
      isAcquiring: true,
      connectedCount: 0
    }
    expect(leftoverHeldHonorMediaCommandPlaybackSpeed(leftoverHeldIdleAcquiring)).toBe(false)
    expect(leftoverHeldRefusesMediaCommandPlaybackSpeed(leftoverHeldIdleAcquiring)).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandPlaybackSpeed({
        isSessionHeld: true,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandPlaybackSpeed({
        isSessionHeld: false,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(false)
  })
})
