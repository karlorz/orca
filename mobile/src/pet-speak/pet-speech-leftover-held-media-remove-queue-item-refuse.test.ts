import { describe, expect, it } from 'vitest'
import {
  leftoverHeldHonorMediaCommandRemoveQueueItem,
  leftoverHeldRefusesMediaCommandRemoveQueueItem
} from './pet-speech-leftover-held-media-remove-queue-item-refuse'

describe('leftover-held refuses media-command remove-queue-item', () => {
  it('fail-closed leftover-held never honors REMOVE-QUEUE-ITEM', () => {
    const leftoverHeldIdleAcquiring = {
      isSessionHeld: true,
      isAcquiring: true,
      connectedCount: 0
    }
    expect(leftoverHeldHonorMediaCommandRemoveQueueItem(leftoverHeldIdleAcquiring)).toBe(false)
    expect(leftoverHeldRefusesMediaCommandRemoveQueueItem(leftoverHeldIdleAcquiring)).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandRemoveQueueItem({
        isSessionHeld: true,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandRemoveQueueItem({
        isSessionHeld: false,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(false)
  })
})
