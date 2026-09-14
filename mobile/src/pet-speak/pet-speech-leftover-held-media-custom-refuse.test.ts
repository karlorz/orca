import { describe, expect, it } from 'vitest'
import {
  leftoverHeldHonorMediaCommandCustom,
  leftoverHeldRefusesMediaCommandCustom
} from './pet-speech-leftover-held-media-custom-refuse'

describe('leftover-held refuses media-command custom', () => {
  it('fail-closed leftover-held never honors CUSTOM', () => {
    const leftoverHeldIdleAcquiring = {
      isSessionHeld: true,
      isAcquiring: true,
      connectedCount: 0
    }
    expect(leftoverHeldHonorMediaCommandCustom(leftoverHeldIdleAcquiring)).toBe(false)
    expect(leftoverHeldRefusesMediaCommandCustom(leftoverHeldIdleAcquiring)).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandCustom({
        isSessionHeld: true,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(true)
    expect(
      leftoverHeldRefusesMediaCommandCustom({
        isSessionHeld: false,
        isAcquiring: false,
        connectedCount: 0
      })
    ).toBe(false)
  })
})
