import { describe, expect, it } from 'vitest'
import {
  leftoverHeldHonorMediaCommandClearQueue,
  leftoverHeldRefusesMediaCommandClearQueue
} from './pet-speech-leftover-held-media-clear-queue-refuse'

describe('leftover-held refuses media-command CLEAR-QUEUE', () => {
  it('fail-closed leftover-held never honors CLEAR-QUEUE', () => {
    const leftoverHeldIdleAcquiring = {
      isSessionHeld: true,
      isAcquiring: true,
      connectedCount: 0
    }
    expect(leftoverHeldHonorMediaCommandClearQueue(leftoverHeldIdleAcquiring)).toBe(false)
    expect(leftoverHeldRefusesMediaCommandClearQueue(leftoverHeldIdleAcquiring)).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandClearQueue({
        isSessionHeld: true,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandClearQueue({
        isSessionHeld: false,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(false)
  })
})
