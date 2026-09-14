import { describe, expect, it } from 'vitest'
import {
  leftoverHeldHonorMediaCommandReplaceQueue,
  leftoverHeldRefusesMediaCommandReplaceQueue
} from './pet-speech-leftover-held-media-replace-queue-refuse'

describe('leftover-held refuses media-command REPLACE-QUEUE', () => {
  it('fail-closed leftover-held never honors REPLACE-QUEUE', () => {
    const leftoverHeldIdleAcquiring = {
      isSessionHeld: true,
      isAcquiring: true,
      connectedCount: 0
    }
    expect(leftoverHeldHonorMediaCommandReplaceQueue(leftoverHeldIdleAcquiring)).toBe(false)
    expect(leftoverHeldRefusesMediaCommandReplaceQueue(leftoverHeldIdleAcquiring)).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandReplaceQueue({
        isSessionHeld: true,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandReplaceQueue({
        isSessionHeld: false,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(false)
  })
})
