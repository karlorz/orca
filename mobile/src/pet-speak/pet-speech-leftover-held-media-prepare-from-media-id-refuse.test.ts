import { describe, expect, it } from 'vitest'
import {
  leftoverHeldHonorMediaCommandPrepareFromMediaId,
  leftoverHeldRefusesMediaCommandPrepareFromMediaId
} from './pet-speech-leftover-held-media-prepare-from-media-id-refuse'

describe('leftover-held refuses media-command prepare-from-media-id', () => {
  it('fail-closed leftover-held never honors PREPARE-FROM-MEDIA-ID', () => {
    const leftoverHeldIdleAcquiring = {
      isSessionHeld: true,
      isAcquiring: true,
      connectedCount: 0
    }
    expect(leftoverHeldHonorMediaCommandPrepareFromMediaId(leftoverHeldIdleAcquiring)).toBe(false)
    expect(leftoverHeldRefusesMediaCommandPrepareFromMediaId(leftoverHeldIdleAcquiring)).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandPrepareFromMediaId({
        isSessionHeld: true,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandPrepareFromMediaId({
        isSessionHeld: false,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(false)
  })
})
