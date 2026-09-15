import { describe, expect, it } from 'vitest'
import {
  leftoverHeldRefusesTtsStart,
  leftoverHeldStartTts
} from './pet-speech-leftover-held-tts-refuse'

describe('leftover-held refuses TTS start', () => {
  it('fail-closed leftover-held never starts TTS', () => {
    const leftoverHeldIdleAcquiring = {
      isSessionHeld: true,
      isAcquiring: true,
      connectedCount: 0
    }
    expect(leftoverHeldStartTts(leftoverHeldIdleAcquiring)).toBe(false)
    expect(leftoverHeldRefusesTtsStart(leftoverHeldIdleAcquiring)).toBe(true)
    expect(
      leftoverHeldRefusesTtsStart({
        isSessionHeld: true,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(true)
    expect(
      leftoverHeldRefusesTtsStart({
        isSessionHeld: false,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(false)
  })
})
