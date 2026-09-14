import { describe, expect, it } from 'vitest'
import {
  leftoverHeldHonorMediaCommandRemoveQueueItemAt,
  leftoverHeldRefusesMediaCommandRemoveQueueItemAt
} from './pet-speech-leftover-held-media-remove-queue-item-at-refuse'

describe('leftover-held refuses media-command REMOVE-QUEUE-ITEM-AT', () => {
  it('fail-closed leftover-held never honors onRemoveQueueItemAt', () => {
    const leftoverHeldIdleAcquiring = {
      isSessionHeld: true,
      isAcquiring: true,
      connectedCount: 0
    }
    expect(leftoverHeldHonorMediaCommandRemoveQueueItemAt(leftoverHeldIdleAcquiring)).toBe(false)
    expect(leftoverHeldRefusesMediaCommandRemoveQueueItemAt(leftoverHeldIdleAcquiring)).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandRemoveQueueItemAt({
        isSessionHeld: true,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandRemoveQueueItemAt({
        isSessionHeld: false,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(false)
  })
})
