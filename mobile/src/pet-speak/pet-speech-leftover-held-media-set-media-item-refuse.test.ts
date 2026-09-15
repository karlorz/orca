import { describe, expect, it } from 'vitest'
import {
  leftoverHeldHonorMediaCommandSetMediaItem,
  leftoverHeldRefusesMediaCommandSetMediaItem
} from './pet-speech-leftover-held-media-set-media-item-refuse'

describe('leftover-held refuses media-command SET-MEDIA-ITEM', () => {
  it('fail-closed leftover-held never honors SET-MEDIA-ITEM', () => {
    const leftoverHeldIdleAcquiring = {
      isSessionHeld: true,
      isAcquiring: true,
      connectedCount: 0
    }
    expect(leftoverHeldHonorMediaCommandSetMediaItem(leftoverHeldIdleAcquiring)).toBe(false)
    expect(leftoverHeldRefusesMediaCommandSetMediaItem(leftoverHeldIdleAcquiring)).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandSetMediaItem({
        isSessionHeld: true,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandSetMediaItem({
        isSessionHeld: false,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(false)
  })
})
