import { describe, expect, it } from 'vitest'
import {
  leftoverHeldHonorMediaCommandSeekToMediaItem,
  leftoverHeldRefusesMediaCommandSeekToMediaItem
} from './pet-speech-leftover-held-media-seek-to-media-item-refuse'

describe('leftover-held refuses media-command seek-to-media-item', () => {
  it('fail-closed leftover-held never honors SEEK-TO-MEDIA-ITEM', () => {
    const leftoverHeldIdleAcquiring = {
      isSessionHeld: true,
      isAcquiring: true,
      connectedCount: 0
    }
    expect(leftoverHeldHonorMediaCommandSeekToMediaItem(leftoverHeldIdleAcquiring)).toBe(false)
    expect(leftoverHeldRefusesMediaCommandSeekToMediaItem(leftoverHeldIdleAcquiring)).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandSeekToMediaItem({
        isSessionHeld: true,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandSeekToMediaItem({
        isSessionHeld: false,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(false)
  })
})
