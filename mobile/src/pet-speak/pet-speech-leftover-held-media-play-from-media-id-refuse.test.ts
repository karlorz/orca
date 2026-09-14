import { describe, expect, it } from 'vitest'
import {
  leftoverHeldHonorMediaCommandPlayFromMediaId,
  leftoverHeldRefusesMediaCommandPlayFromMediaId
} from './pet-speech-leftover-held-media-play-from-media-id-refuse'

describe('leftover-held refuses media-command play-from-media-id', () => {
  it('fail-closed leftover-held never honors PLAY-FROM-MEDIA-ID', () => {
    const leftoverHeldIdleAcquiring = {
      isSessionHeld: true,
      isAcquiring: true,
      connectedCount: 0
    }
    expect(leftoverHeldHonorMediaCommandPlayFromMediaId(leftoverHeldIdleAcquiring)).toBe(false)
    expect(leftoverHeldRefusesMediaCommandPlayFromMediaId(leftoverHeldIdleAcquiring)).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandPlayFromMediaId({
        isSessionHeld: true,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandPlayFromMediaId({
        isSessionHeld: false,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(false)
  })
})
