import { describe, expect, it } from 'vitest'
import {
  leftoverHeldHonorMediaCommandSetTrackSelection,
  leftoverHeldRefusesMediaCommandSetTrackSelection
} from './pet-speech-leftover-held-media-set-track-selection-refuse'

describe('leftover-held refuses media-command SET-TRACK-SELECTION', () => {
  it('fail-closed leftover-held never honors SET-TRACK-SELECTION', () => {
    const leftoverHeldIdleAcquiring = {
      isSessionHeld: true,
      isAcquiring: true,
      connectedCount: 0
    }
    expect(leftoverHeldHonorMediaCommandSetTrackSelection(leftoverHeldIdleAcquiring)).toBe(false)
    expect(leftoverHeldRefusesMediaCommandSetTrackSelection(leftoverHeldIdleAcquiring)).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandSetTrackSelection({
        isSessionHeld: true,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandSetTrackSelection({
        isSessionHeld: false,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(false)
  })
})
