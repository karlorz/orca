import { describe, expect, it } from 'vitest'
import {
  leftoverHeldHonorMediaCommandMoveQueueItem,
  leftoverHeldRefusesMediaCommandMoveQueueItem
} from './pet-speech-leftover-held-media-move-queue-item-refuse'

describe('leftover-held refuses media-command move-queue-item', () => {
  it('fail-closed leftover-held never honors MOVE-QUEUE-ITEM', () => {
    const leftoverHeldIdleAcquiring = {
      isSessionHeld: true,
      isAcquiring: true,
      connectedCount: 0
    }
    expect(leftoverHeldHonorMediaCommandMoveQueueItem(leftoverHeldIdleAcquiring)).toBe(false)
    expect(leftoverHeldRefusesMediaCommandMoveQueueItem(leftoverHeldIdleAcquiring)).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandMoveQueueItem({
        isSessionHeld: true,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandMoveQueueItem({
        isSessionHeld: false,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(false)
  })
})
