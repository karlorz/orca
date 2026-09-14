import { describe, expect, it } from 'vitest'
import {
  leftoverHeldHonorMediaCommandPrepareFromSearch,
  leftoverHeldRefusesMediaCommandPrepareFromSearch
} from './pet-speech-leftover-held-media-prepare-from-search-refuse'

describe('leftover-held refuses media-command prepare-from-search', () => {
  it('fail-closed leftover-held never honors PREPARE-FROM-SEARCH', () => {
    const leftoverHeldIdleAcquiring = {
      isSessionHeld: true,
      isAcquiring: true,
      connectedCount: 0
    }
    expect(leftoverHeldHonorMediaCommandPrepareFromSearch(leftoverHeldIdleAcquiring)).toBe(false)
    expect(leftoverHeldRefusesMediaCommandPrepareFromSearch(leftoverHeldIdleAcquiring)).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandPrepareFromSearch({
        isSessionHeld: true,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandPrepareFromSearch({
        isSessionHeld: false,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(false)
  })
})
