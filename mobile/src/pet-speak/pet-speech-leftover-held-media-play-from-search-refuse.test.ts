import { describe, expect, it } from 'vitest'
import {
  leftoverHeldHonorMediaCommandPlayFromSearch,
  leftoverHeldRefusesMediaCommandPlayFromSearch
} from './pet-speech-leftover-held-media-play-from-search-refuse'

describe('leftover-held refuses media-command play-from-search', () => {
  it('fail-closed leftover-held never honors PLAY-FROM-SEARCH', () => {
    const leftoverHeldIdleAcquiring = {
      isSessionHeld: true,
      isAcquiring: true,
      connectedCount: 0
    }
    expect(leftoverHeldHonorMediaCommandPlayFromSearch(leftoverHeldIdleAcquiring)).toBe(false)
    expect(leftoverHeldRefusesMediaCommandPlayFromSearch(leftoverHeldIdleAcquiring)).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandPlayFromSearch({
        isSessionHeld: true,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandPlayFromSearch({
        isSessionHeld: false,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(false)
  })
})
