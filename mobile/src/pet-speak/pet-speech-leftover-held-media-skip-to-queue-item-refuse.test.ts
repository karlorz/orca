import { describe, expect, it } from 'vitest'
import {
  leftoverHeldHonorMediaCommandSkipToQueueItem,
  leftoverHeldRefusesMediaCommandSkipToQueueItem
} from './pet-speech-leftover-held-media-skip-to-queue-item-refuse'

describe('leftover-held refuses media-command skip-to-queue-item', () => {
  it('fail-closed leftover-held never honors SKIP-TO-QUEUE-ITEM', () => {
    const leftoverHeldIdleAcquiring = {
      isSessionHeld: true,
      isAcquiring: true,
      connectedCount: 0
    }
    expect(leftoverHeldHonorMediaCommandSkipToQueueItem(leftoverHeldIdleAcquiring)).toBe(false)
    expect(leftoverHeldRefusesMediaCommandSkipToQueueItem(leftoverHeldIdleAcquiring)).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandSkipToQueueItem({
        isSessionHeld: true,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandSkipToQueueItem({
        isSessionHeld: false,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(false)
  })
})
