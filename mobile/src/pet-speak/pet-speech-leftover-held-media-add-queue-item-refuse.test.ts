import { describe, expect, it } from 'vitest'
import {
  leftoverHeldHonorMediaCommandAddQueueItem,
  leftoverHeldRefusesMediaCommandAddQueueItem
} from './pet-speech-leftover-held-media-add-queue-item-refuse'

describe('leftover-held refuses media-command add-queue-item', () => {
  it('fail-closed leftover-held never honors ADD-QUEUE-ITEM', () => {
    const leftoverHeldIdleAcquiring = {
      isSessionHeld: true,
      isAcquiring: true,
      connectedCount: 0
    }
    expect(leftoverHeldHonorMediaCommandAddQueueItem(leftoverHeldIdleAcquiring)).toBe(false)
    expect(leftoverHeldRefusesMediaCommandAddQueueItem(leftoverHeldIdleAcquiring)).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandAddQueueItem({
        isSessionHeld: true,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandAddQueueItem({
        isSessionHeld: false,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(false)
  })
})
