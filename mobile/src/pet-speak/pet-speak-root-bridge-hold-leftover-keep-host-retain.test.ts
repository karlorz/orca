import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getHostConnectionRetainRuntime,
  resetHostConnectionRetainRuntimeForTests
} from './host-connection-retain'
import { isLeftoverHeld } from './pet-speech-leftover-held-tts-refuse'
import {
  evaluatePetVoiceHold,
  onHostClientStateForHold,
  type PetVoiceHoldRuntime
} from './pet-speak-root-bridge-hold'
import { PET_VOICE_CONNECTED_TEXT } from './pet-voice-hold-decision'

function leftoverHeldRuntime(keepHostConnection: () => boolean): PetVoiceHoldRuntime {
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
    overlayWhileSpeaking: () => false,
    keepHostConnection,
    petSpeechEnabled: () => true
  }
}

describe('leftover-held keep-host toggle republishes retain', () => {
  afterEach(() => {
    resetHostConnectionRetainRuntimeForTests()
  })

  it('fail-closed leftover-held keep-host toggle republishes retain while the host stays connected', () => {
    let keepHost = true
    const runtime = leftoverHeldRuntime(() => keepHost)
    expect(
      isLeftoverHeld({
        isSessionHeld: runtime.holdState.current.isSessionHeld,
        isAcquiring: runtime.holdState.current.isAcquiring,
        connectedCount: 0
      })
    ).toBe(true)

    evaluatePetVoiceHold(runtime)
    expect(getHostConnectionRetainRuntime()).toBe(true)

    keepHost = false
    onHostClientStateForHold(runtime, {
      previousState: 'connected',
      nextState: 'connected',
      subscriptionChanged: false
    })
    expect(getHostConnectionRetainRuntime()).toBe(false)
  })
})
