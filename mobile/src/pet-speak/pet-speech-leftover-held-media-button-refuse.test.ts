import { describe, expect, it } from 'vitest'
import {
  leftoverHeldHonorMediaCommandMediaButton,
  leftoverHeldRefusesMediaCommandMediaButton
} from './pet-speech-leftover-held-media-button-refuse'

describe('leftover-held refuses media-command MEDIA-BUTTON', () => {
  it('fail-closed leftover-held never honors onMediaButtonEvent', () => {
    const leftoverHeldIdleAcquiring = {
      isSessionHeld: true,
      isAcquiring: true,
      connectedCount: 0
    }
    expect(leftoverHeldHonorMediaCommandMediaButton(leftoverHeldIdleAcquiring)).toBe(false)
    expect(leftoverHeldRefusesMediaCommandMediaButton(leftoverHeldIdleAcquiring)).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandMediaButton({
        isSessionHeld: true,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandMediaButton({
        isSessionHeld: false,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(false)
  })
})
