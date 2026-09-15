import { describe, expect, it } from 'vitest'
import {
  leftoverHeldHonorMediaCommandPrepare,
  leftoverHeldRefusesMediaCommandPrepare
} from './pet-speech-leftover-held-media-prepare-refuse'

describe('leftover-held refuses media-command prepare', () => {
  it('fail-closed leftover-held never honors PREPARE', () => {
    const leftoverHeldIdleAcquiring = {
      isSessionHeld: true,
      isAcquiring: true,
      connectedCount: 0
    }
    expect(leftoverHeldHonorMediaCommandPrepare(leftoverHeldIdleAcquiring)).toBe(false)
    expect(leftoverHeldRefusesMediaCommandPrepare(leftoverHeldIdleAcquiring)).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandPrepare({
        isSessionHeld: true,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandPrepare({
        isSessionHeld: false,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(false)
  })
})
