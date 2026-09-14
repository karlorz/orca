import { describe, expect, it } from 'vitest'
import {
  leftoverHeldHonorMediaCommandSetPlaylist,
  leftoverHeldRefusesMediaCommandSetPlaylist
} from './pet-speech-leftover-held-media-set-playlist-refuse'

describe('leftover-held refuses media-command SET-PLAYLIST', () => {
  it('fail-closed leftover-held never honors SET-PLAYLIST', () => {
    const leftoverHeldIdleAcquiring = {
      isSessionHeld: true,
      isAcquiring: true,
      connectedCount: 0
    }
    expect(leftoverHeldHonorMediaCommandSetPlaylist(leftoverHeldIdleAcquiring)).toBe(false)
    expect(leftoverHeldRefusesMediaCommandSetPlaylist(leftoverHeldIdleAcquiring)).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandSetPlaylist({
        isSessionHeld: true,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandSetPlaylist({
        isSessionHeld: false,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(false)
  })
})
