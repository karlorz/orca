import { describe, expect, it } from 'vitest'
import {
  leftoverHeldHonorMediaCommandAddQueueItemAt,
  leftoverHeldRefusesMediaCommandAddQueueItemAt
} from './pet-speech-leftover-held-media-add-queue-item-at-refuse'

describe('leftover-held refuses media-command ADD-QUEUE-ITEM-AT', () => {
  it('fail-closed leftover-held never honors onAddQueueItemAt', () => {
    const leftoverHeldIdleAcquiring = {
      isSessionHeld: true,
      isAcquiring: true,
      connectedCount: 0
    }
    expect(leftoverHeldHonorMediaCommandAddQueueItemAt(leftoverHeldIdleAcquiring)).toBe(false)
    expect(leftoverHeldRefusesMediaCommandAddQueueItemAt(leftoverHeldIdleAcquiring)).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandAddQueueItemAt({
        isSessionHeld: true,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandAddQueueItemAt({
        isSessionHeld: false,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(false)
  })
})
