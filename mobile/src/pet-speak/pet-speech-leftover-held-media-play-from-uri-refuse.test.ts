import { describe, expect, it } from 'vitest'
import {
  leftoverHeldHonorMediaCommandPlayFromUri,
  leftoverHeldRefusesMediaCommandPlayFromUri
} from './pet-speech-leftover-held-media-play-from-uri-refuse'

describe('leftover-held refuses media-command play-from-uri', () => {
  it('fail-closed leftover-held never honors PLAY-FROM-URI', () => {
    const leftoverHeldIdleAcquiring = {
      isSessionHeld: true,
      isAcquiring: true,
      connectedCount: 0
    }
    expect(leftoverHeldHonorMediaCommandPlayFromUri(leftoverHeldIdleAcquiring)).toBe(false)
    expect(leftoverHeldRefusesMediaCommandPlayFromUri(leftoverHeldIdleAcquiring)).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandPlayFromUri({
        isSessionHeld: true,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandPlayFromUri({
        isSessionHeld: false,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(false)
  })
})
