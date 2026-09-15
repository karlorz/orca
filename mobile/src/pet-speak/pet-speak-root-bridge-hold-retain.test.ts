import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getHostConnectionRetainRuntime,
  resetHostConnectionRetainRuntimeForTests
} from './host-connection-retain'
import {
  evaluatePetVoiceHold,
  onHostClientStateForHold,
  type PetVoiceHoldRuntime
} from './pet-speak-root-bridge-hold'
import { PET_VOICE_CONNECTED_TEXT } from './pet-voice-hold-decision'

function runtime(overrides: Partial<PetVoiceHoldRuntime> = {}): PetVoiceHoldRuntime {
  return {
    isAndroid: true,
    isDisposed: () => false,
    holdState: {
      current: {
        isSessionHeld: true,
        isAcquiring: false,
        reconnectingSince: null,
        lastNotificationText: PET_VOICE_CONNECTED_TEXT
      }
    },
    graceTimer: { current: null },
    currentSubs: new Map(),
    hostStates: new Map(),
    speechStates: new Map([['host-1', 'ready']]),
    ensureNotificationPermissions: vi.fn(async () => true),
    acquireVoiceSession: vi.fn(async () => ({ held: true })),
    releaseVoiceSession: vi.fn(async () => {}),
    updateVoiceSessionNotification: vi.fn(async () => {}),
    persistEnabled: () => true,
    keepWhenNoHost: () => false,
    overlayWhileSpeaking: () => false,
    keepHostConnection: () => true,
    petSpeechEnabled: () => true,
    ...overrides
  }
}

describe('evaluatePetVoiceHold retain publish', () => {
  afterEach(() => {
    resetHostConnectionRetainRuntimeForTests()
  })

  it('publishes retain when pet speech is on, persist is held, and keep-host is on', () => {
    evaluatePetVoiceHold(runtime())
    expect(getHostConnectionRetainRuntime()).toBe(true)
  })

  it('clears retain when persist is off even if the session is still held', () => {
    evaluatePetVoiceHold(
      runtime({
        persistEnabled: () => false
      })
    )
    expect(getHostConnectionRetainRuntime()).toBe(false)
  })

  it('clears retain when keep-host is off even if persist is held', () => {
    evaluatePetVoiceHold(
      runtime({
        keepHostConnection: () => false
      })
    )
    expect(getHostConnectionRetainRuntime()).toBe(false)
  })

  it('republishes retain when keep-host flips even if the host stays connected', () => {
    evaluatePetVoiceHold(runtime({ keepHostConnection: () => true }))
    expect(getHostConnectionRetainRuntime()).toBe(true)
    onHostClientStateForHold(runtime({ keepHostConnection: () => false }), {
      previousState: 'connected',
      nextState: 'connected',
      subscriptionChanged: false
    })
    expect(getHostConnectionRetainRuntime()).toBe(false)
  })

  it('clears retain when the master is off', () => {
    evaluatePetVoiceHold(
      runtime({
        petSpeechEnabled: () => false
      })
    )
    expect(getHostConnectionRetainRuntime()).toBe(false)
  })

  it('persist-on keepWhenNoHost still holds retain when session stayed held', () => {
    evaluatePetVoiceHold(
      runtime({
        speechStates: new Map(),
        persistEnabled: () => true,
        keepWhenNoHost: () => true,
        keepHostConnection: () => true
      })
    )
    expect(getHostConnectionRetainRuntime()).toBe(true)
  })

  it('persist-on keepWhenNoHost after Pause-after-keepHold does not re-acquire or release', () => {
    const acquireVoiceSession = vi.fn(async () => ({ held: true }))
    const releaseVoiceSession = vi.fn(async () => {})
    evaluatePetVoiceHold(
      runtime({
        holdState: {
          current: {
            isSessionHeld: false,
            isAcquiring: false,
            reconnectingSince: null,
            lastNotificationText: null
          }
        },
        speechStates: new Map(),
        persistEnabled: () => true,
        keepWhenNoHost: () => true,
        acquireVoiceSession,
        releaseVoiceSession
      })
    )
    expect(acquireVoiceSession).not.toHaveBeenCalled()
    expect(releaseVoiceSession).not.toHaveBeenCalled()
    expect(getHostConnectionRetainRuntime()).toBe(false)
  })

  it('persist-on keepWhenNoHost after Pause-after-keepHold still holds session when keep-host is off', () => {
    const releaseVoiceSession = vi.fn(async () => {})
    evaluatePetVoiceHold(
      runtime({
        speechStates: new Map(),
        persistEnabled: () => true,
        keepWhenNoHost: () => true,
        keepHostConnection: () => false,
        releaseVoiceSession
      })
    )
    expect(releaseVoiceSession).not.toHaveBeenCalled()
    expect(getHostConnectionRetainRuntime()).toBe(false)
  })

  it('persist-on overlay write-off after Pause-after-keepHold still releases held session', () => {
    const releaseVoiceSession = vi.fn(async () => {})
    evaluatePetVoiceHold(
      runtime({
        speechStates: new Map(),
        persistEnabled: () => false,
        overlayWhileSpeaking: () => true,
        releaseVoiceSession
      })
    )
    expect(releaseVoiceSession).toHaveBeenCalled()
    expect(getHostConnectionRetainRuntime()).toBe(false)
  })

  it('persist-off overlay after Pause-after-keepHold never acquires', () => {
    const acquireVoiceSession = vi.fn(async () => ({ held: true }))
    evaluatePetVoiceHold(
      runtime({
        holdState: {
          current: {
            isSessionHeld: false,
            isAcquiring: false,
            reconnectingSince: null,
            lastNotificationText: null
          }
        },
        persistEnabled: () => false,
        overlayWhileSpeaking: () => true,
        acquireVoiceSession
      })
    )
    expect(acquireVoiceSession).not.toHaveBeenCalled()
    expect(getHostConnectionRetainRuntime()).toBe(false)
  })

  it('persist-off keepWhenNoHost after Pause-after-keepHold still releases held session', () => {
    const releaseVoiceSession = vi.fn(async () => {})
    evaluatePetVoiceHold(
      runtime({
        speechStates: new Map(),
        persistEnabled: () => false,
        keepWhenNoHost: () => true,
        releaseVoiceSession
      })
    )
    expect(releaseVoiceSession).toHaveBeenCalled()
    expect(getHostConnectionRetainRuntime()).toBe(false)
  })
})
