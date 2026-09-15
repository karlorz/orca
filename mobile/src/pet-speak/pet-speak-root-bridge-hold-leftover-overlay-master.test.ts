import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getHostConnectionRetainRuntime,
  resetHostConnectionRetainRuntimeForTests
} from './host-connection-retain'
import { isLeftoverHeld } from './pet-speech-leftover-held-tts-refuse'
import { evaluatePetVoiceHold, type PetVoiceHoldRuntime } from './pet-speak-root-bridge-hold'
import { PET_VOICE_CONNECTED_TEXT } from './pet-voice-hold-decision'

function leftoverHeldOverlayMasterRuntime(): PetVoiceHoldRuntime {
  return {
    isAndroid: true,
    isDisposed: () => false,
    holdState: {
      current: {
        isSessionHeld: true,
        isAcquiring: true,
        reconnectingSince: null,
        lastNotificationText: PET_VOICE_CONNECTED_TEXT
      }
    },
    graceTimer: { current: null },
    currentSubs: new Map(),
    hostStates: new Map([['host-1', 'connected']]),
    speechStates: new Map(),
    ensureNotificationPermissions: vi.fn(async () => true),
    acquireVoiceSession: vi.fn(async () => ({ held: true })),
    releaseVoiceSession: vi.fn(async () => {}),
    updateVoiceSessionNotification: vi.fn(async () => {}),
    persistEnabled: () => true,
    keepWhenNoHost: () => true,
    overlayWhileSpeaking: () => true,
    keepHostConnection: () => true,
    petSpeechEnabled: () => false
  }
}

describe('leftover-held overlay/master hold wiring', () => {
  afterEach(() => {
    resetHostConnectionRetainRuntimeForTests()
  })

  it('fail-closed leftover-held overlay on and master off never republishes retain or acquires', () => {
    const runtime = leftoverHeldOverlayMasterRuntime()
    expect(
      isLeftoverHeld({
        isSessionHeld: runtime.holdState.current.isSessionHeld,
        isAcquiring: runtime.holdState.current.isAcquiring,
        connectedCount: 0
      })
    ).toBe(true)

    evaluatePetVoiceHold(runtime)
    expect(runtime.acquireVoiceSession).not.toHaveBeenCalled()
    expect(getHostConnectionRetainRuntime()).toBe(false)
  })
})
