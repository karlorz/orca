import { describe, expect, it } from 'vitest'
import { persistOffOverlayAfterKeepHoldPauseNeverHoldsSession } from './pet-speech-overlay-hold-decision'
import { isLeftoverHeld } from './pet-speech-leftover-held-tts-refuse'
import {
  decidePetVoiceHoldAction,
  PET_VOICE_CONNECTED_TEXT,
  type PetVoiceHoldState
} from './pet-voice-hold-decision'

describe('leftover-held overlay afterKeepHoldPause', () => {
  it('fail-closed leftover-held overlay afterKeepHoldPause persist-off never acquires', () => {
    const leftoverHeldIdleAcquiring: PetVoiceHoldState = {
      isSessionHeld: true,
      isAcquiring: true,
      reconnectingSince: null,
      lastNotificationText: PET_VOICE_CONNECTED_TEXT
    }
    expect(
      isLeftoverHeld({
        isSessionHeld: leftoverHeldIdleAcquiring.isSessionHeld,
        isAcquiring: leftoverHeldIdleAcquiring.isAcquiring,
        connectedCount: 0
      })
    ).toBe(true)
    expect(persistOffOverlayAfterKeepHoldPauseNeverHoldsSession(false, true, true)).toBe(true)

    const action = decidePetVoiceHoldAction({
      state: leftoverHeldIdleAcquiring,
      connectedCount: 0,
      reconnectingCount: 0,
      now: 5000,
      persistEnabled: false,
      overlayWhileSpeaking: true,
      afterKeepHoldPause: true
    })
    expect(action.type).not.toBe('acquire')
    expect(action.nextState.isAcquiring).toBe(false)
  })
})
