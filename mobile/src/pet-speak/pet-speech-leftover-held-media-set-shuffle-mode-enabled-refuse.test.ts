import { describe, expect, it } from 'vitest'
import {
  leftoverHeldHonorMediaCommandSetShuffleModeEnabled,
  leftoverHeldRefusesMediaCommandSetShuffleModeEnabled
} from './pet-speech-leftover-held-media-set-shuffle-mode-enabled-refuse'

describe('leftover-held refuses media-command SET-SHUFFLE-MODE-ENABLED', () => {
  it('fail-closed leftover-held never honors onSetShuffleModeEnabled', () => {
    const leftoverHeldIdleAcquiring = {
      isSessionHeld: true,
      isAcquiring: true,
      connectedCount: 0
    }
    expect(leftoverHeldHonorMediaCommandSetShuffleModeEnabled(leftoverHeldIdleAcquiring)).toBe(
      false
    )
    expect(leftoverHeldRefusesMediaCommandSetShuffleModeEnabled(leftoverHeldIdleAcquiring)).toBe(
      true
    )
    expect(
      leftoverHeldRefusesMediaCommandSetShuffleModeEnabled({
        isSessionHeld: true,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandSetShuffleModeEnabled({
        isSessionHeld: false,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(false)
  })
})
