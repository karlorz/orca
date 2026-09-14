import { describe, expect, it } from 'vitest'
import {
  leftoverHeldHonorMediaCommandSetPlaybackSlot,
  leftoverHeldRefusesMediaCommandSetPlaybackSlot
} from './pet-speech-leftover-held-media-set-playback-slot-refuse'

describe('leftover-held refuses media-command SET-PLAYBACK-SLOT', () => {
  it('fail-closed leftover-held never honors SET-PLAYBACK-SLOT', () => {
    const leftoverHeldIdleAcquiring = {
      isSessionHeld: true,
      isAcquiring: true,
      connectedCount: 0
    }
    expect(leftoverHeldHonorMediaCommandSetPlaybackSlot(leftoverHeldIdleAcquiring)).toBe(false)
    expect(leftoverHeldRefusesMediaCommandSetPlaybackSlot(leftoverHeldIdleAcquiring)).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandSetPlaybackSlot({
        isSessionHeld: true,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandSetPlaybackSlot({
        isSessionHeld: false,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(false)
  })
})
