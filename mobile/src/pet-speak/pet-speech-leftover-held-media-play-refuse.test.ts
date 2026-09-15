import { describe, expect, it } from 'vitest'
import {
  leftoverHeldHonorMediaCommandPlay,
  leftoverHeldRefusesMediaCommandPlay
} from './pet-speech-leftover-held-media-play-refuse'

describe('leftover-held refuses media-command play', () => {
  it('fail-closed leftover-held never honors PLAY', () => {
    const leftoverHeldIdleAcquiring = {
      isSessionHeld: true,
      isAcquiring: true,
      connectedCount: 0
    }
    expect(leftoverHeldHonorMediaCommandPlay(leftoverHeldIdleAcquiring)).toBe(false)
    expect(leftoverHeldRefusesMediaCommandPlay(leftoverHeldIdleAcquiring)).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandPlay({
        isSessionHeld: true,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandPlay({
        isSessionHeld: false,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(false)
  })
})
