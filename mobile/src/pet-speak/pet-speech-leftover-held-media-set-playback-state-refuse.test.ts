import { describe, expect, it } from 'vitest'
import {
  leftoverHeldHonorMediaCommandSetPlaybackState,
  leftoverHeldRefusesMediaCommandSetPlaybackState
} from './pet-speech-leftover-held-media-set-playback-state-refuse'

describe('leftover-held refuses media-command SET-PLAYBACK-STATE', () => {
  it('fail-closed leftover-held never honors SET-PLAYBACK-STATE', () => {
    const leftoverHeldIdleAcquiring = {
      isSessionHeld: true,
      isAcquiring: true,
      connectedCount: 0
    }
    expect(leftoverHeldHonorMediaCommandSetPlaybackState(leftoverHeldIdleAcquiring)).toBe(false)
    expect(leftoverHeldRefusesMediaCommandSetPlaybackState(leftoverHeldIdleAcquiring)).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandSetPlaybackState({
        isSessionHeld: true,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandSetPlaybackState({
        isSessionHeld: false,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(false)
  })
})
