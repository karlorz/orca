import { describe, expect, it } from 'vitest'
import {
  leftoverHeldHonorMediaCommandOnCommand,
  leftoverHeldRefusesMediaCommandOnCommand
} from './pet-speech-leftover-held-media-on-command-refuse'

describe('leftover-held refuses media-command ON-COMMAND', () => {
  it('fail-closed leftover-held never honors onCommand', () => {
    const leftoverHeldIdleAcquiring = {
      isSessionHeld: true,
      isAcquiring: true,
      connectedCount: 0
    }
    expect(leftoverHeldHonorMediaCommandOnCommand(leftoverHeldIdleAcquiring)).toBe(false)
    expect(leftoverHeldRefusesMediaCommandOnCommand(leftoverHeldIdleAcquiring)).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandOnCommand({
        isSessionHeld: true,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandOnCommand({
        isSessionHeld: false,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(false)
  })
})
