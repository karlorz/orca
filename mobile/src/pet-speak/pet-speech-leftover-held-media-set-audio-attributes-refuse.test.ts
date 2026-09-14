import { describe, expect, it } from 'vitest'
import {
  leftoverHeldHonorMediaCommandSetAudioAttributes,
  leftoverHeldRefusesMediaCommandSetAudioAttributes
} from './pet-speech-leftover-held-media-set-audio-attributes-refuse'

describe('leftover-held refuses media-command SET-AUDIO-ATTRIBUTES', () => {
  it('fail-closed leftover-held never honors SET-AUDIO-ATTRIBUTES', () => {
    const leftoverHeldIdleAcquiring = {
      isSessionHeld: true,
      isAcquiring: true,
      connectedCount: 0
    }
    expect(leftoverHeldHonorMediaCommandSetAudioAttributes(leftoverHeldIdleAcquiring)).toBe(false)
    expect(leftoverHeldRefusesMediaCommandSetAudioAttributes(leftoverHeldIdleAcquiring)).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandSetAudioAttributes({
        isSessionHeld: true,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandSetAudioAttributes({
        isSessionHeld: false,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(false)
  })
})
