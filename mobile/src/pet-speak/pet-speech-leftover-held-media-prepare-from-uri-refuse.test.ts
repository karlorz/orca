import { describe, expect, it } from 'vitest'
import {
  leftoverHeldHonorMediaCommandPrepareFromUri,
  leftoverHeldRefusesMediaCommandPrepareFromUri
} from './pet-speech-leftover-held-media-prepare-from-uri-refuse'

describe('leftover-held refuses media-command prepare-from-uri', () => {
  it('fail-closed leftover-held never honors PREPARE-FROM-URI', () => {
    const leftoverHeldIdleAcquiring = {
      isSessionHeld: true,
      isAcquiring: true,
      connectedCount: 0
    }
    expect(leftoverHeldHonorMediaCommandPrepareFromUri(leftoverHeldIdleAcquiring)).toBe(false)
    expect(leftoverHeldRefusesMediaCommandPrepareFromUri(leftoverHeldIdleAcquiring)).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandPrepareFromUri({
        isSessionHeld: true,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandPrepareFromUri({
        isSessionHeld: false,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(false)
  })
})
