import { describe, expect, it } from 'vitest'
import {
  decidePetVoiceHoldAction,
  persistOnKeepWhenNoHostDoesNotReacquireAfterKeepHoldPause,
  persistOnKeepWhenNoHostHoldsAfterKeepHoldPause,
  persistOnKeepWhenNoHostReleasesAfterKeepHoldPause,
  PET_VOICE_RECONNECT_GRACE_MS,
  type PetVoiceHoldState
} from './pet-voice-hold-decision'

describe('decidePetVoiceHoldAction', () => {
  it('exports PET_VOICE_RECONNECT_GRACE_MS as 5 minutes', () => {
    expect(PET_VOICE_RECONNECT_GRACE_MS).toBe(5 * 60 * 1000)
  })

  it('acquires session and sets connected text when at least one host is connected and session is not held', () => {
    const state: PetVoiceHoldState = {
      isSessionHeld: false,
      isAcquiring: false,
      reconnectingSince: null,
      lastNotificationText: null
    }
    const action = decidePetVoiceHoldAction({
      state,
      connectedCount: 1,
      reconnectingCount: 0,
      now: 1000
    })

    expect(action).toEqual({
      type: 'acquire',
      notificationText: 'Pet voice connected',
      nextState: {
        isSessionHeld: false,
        isAcquiring: true,
        reconnectingSince: null,
        lastNotificationText: null
      }
    })
  })

  it('updates notification to connected text when host is connected and held notification is reconnecting', () => {
    const state: PetVoiceHoldState = {
      isSessionHeld: true,
      isAcquiring: false,
      reconnectingSince: 1000,
      lastNotificationText: 'Orca Pet — Reconnecting...'
    }
    const action = decidePetVoiceHoldAction({
      state,
      connectedCount: 1,
      reconnectingCount: 1,
      now: 2000
    })

    expect(action).toEqual({
      type: 'update-notification',
      notificationText: 'Pet voice connected',
      nextState: {
        isSessionHeld: true,
        isAcquiring: false,
        reconnectingSince: null,
        lastNotificationText: 'Pet voice connected'
      }
    })
  })

  it('does nothing if already held and already showing connected text', () => {
    const state: PetVoiceHoldState = {
      isSessionHeld: true,
      isAcquiring: false,
      reconnectingSince: null,
      lastNotificationText: 'Pet voice connected'
    }
    const action = decidePetVoiceHoldAction({
      state,
      connectedCount: 2,
      reconnectingCount: 0,
      now: 2000
    })

    expect(action).toEqual({
      type: 'none',
      nextState: state
    })
  })

  it('starts reconnecting grace and sets reconnecting notification when 0 connected but >=1 reconnecting and session held', () => {
    const state: PetVoiceHoldState = {
      isSessionHeld: true,
      isAcquiring: false,
      reconnectingSince: null,
      lastNotificationText: 'Pet voice connected'
    }
    const action = decidePetVoiceHoldAction({
      state,
      connectedCount: 0,
      reconnectingCount: 1,
      now: 5000
    })

    expect(action).toEqual({
      type: 'update-notification',
      notificationText: 'Orca Pet — Reconnecting...',
      nextState: {
        isSessionHeld: true,
        isAcquiring: false,
        reconnectingSince: 5000,
        lastNotificationText: 'Orca Pet — Reconnecting...'
      }
    })
  })

  it('keeps reconnecting state without redundant notification update if within grace', () => {
    const state: PetVoiceHoldState = {
      isSessionHeld: true,
      isAcquiring: false,
      reconnectingSince: 5000,
      lastNotificationText: 'Orca Pet — Reconnecting...'
    }
    const action = decidePetVoiceHoldAction({
      state,
      connectedCount: 0,
      reconnectingCount: 1,
      now: 5000 + PET_VOICE_RECONNECT_GRACE_MS - 1
    })

    expect(action).toEqual({
      type: 'none',
      nextState: state
    })
  })

  it('releases session when grace period (5 min) expires with no connected hosts', () => {
    const state: PetVoiceHoldState = {
      isSessionHeld: true,
      isAcquiring: false,
      reconnectingSince: 5000,
      lastNotificationText: 'Orca Pet — Reconnecting...'
    }
    const action = decidePetVoiceHoldAction({
      state,
      connectedCount: 0,
      reconnectingCount: 1,
      now: 5000 + PET_VOICE_RECONNECT_GRACE_MS
    })

    expect(action).toEqual({
      type: 'release',
      nextState: {
        isSessionHeld: false,
        isAcquiring: false,
        reconnectingSince: null,
        lastNotificationText: null
      }
    })
  })

  it('holds session and sets reconnecting notification when 0 connected but >=1 connecting or handshaking via stillTryingCount', () => {
    const state: PetVoiceHoldState = {
      isSessionHeld: true,
      isAcquiring: false,
      reconnectingSince: null,
      lastNotificationText: 'Pet voice connected'
    }
    const actionConnecting = decidePetVoiceHoldAction({
      state,
      connectedCount: 0,
      reconnectingCount: 0,
      stillTryingCount: 1,
      now: 5000
    })

    expect(actionConnecting).toEqual({
      type: 'update-notification',
      notificationText: 'Orca Pet — Reconnecting...',
      nextState: {
        isSessionHeld: true,
        isAcquiring: false,
        reconnectingSince: 5000,
        lastNotificationText: 'Orca Pet — Reconnecting...'
      }
    })
  })

  it('acquires a reconnecting session while transport is connected but speech is not ready', () => {
    const state: PetVoiceHoldState = {
      isSessionHeld: false,
      isAcquiring: false,
      reconnectingSince: null,
      lastNotificationText: null
    }
    const action = decidePetVoiceHoldAction({
      state,
      connectedCount: 0,
      reconnectingCount: 1,
      stillTryingCount: 1,
      now: 5000
    })

    expect(action).toEqual({
      type: 'acquire',
      notificationText: 'Orca Pet — Reconnecting...',
      nextState: {
        isSessionHeld: false,
        isAcquiring: true,
        reconnectingSince: 5000,
        lastNotificationText: null
      }
    })
  })

  it('releases immediately when 0 connected and 0 reconnecting (e.g. disconnected or auth-failed)', () => {
    const state: PetVoiceHoldState = {
      isSessionHeld: true,
      isAcquiring: false,
      reconnectingSince: null,
      lastNotificationText: 'Pet voice connected'
    }
    const action = decidePetVoiceHoldAction({
      state,
      connectedCount: 0,
      reconnectingCount: 0,
      now: 5000
    })

    expect(action).toEqual({
      type: 'release',
      nextState: {
        isSessionHeld: false,
        isAcquiring: false,
        reconnectingSince: null,
        lastNotificationText: null
      }
    })
  })

  it('keeps idle FGS when persist and keep-when-no-host are on', () => {
    const state: PetVoiceHoldState = {
      isSessionHeld: true,
      isAcquiring: false,
      reconnectingSince: null,
      lastNotificationText: 'Pet voice connected'
    }
    const action = decidePetVoiceHoldAction({
      state,
      connectedCount: 0,
      reconnectingCount: 0,
      now: 5000,
      persistEnabled: true,
      keepWhenNoHost: true
    })
    expect(action.type).toBe('none')
    expect(action.nextState.isSessionHeld).toBe(true)
  })

  it('releases when keep-when-no-host is on but persist is off', () => {
    const state: PetVoiceHoldState = {
      isSessionHeld: true,
      isAcquiring: false,
      reconnectingSince: null,
      lastNotificationText: 'Pet voice connected'
    }
    const action = decidePetVoiceHoldAction({
      state,
      connectedCount: 0,
      reconnectingCount: 0,
      now: 5000,
      persistEnabled: false,
      keepWhenNoHost: true
    })
    expect(action.type).toBe('release')
    expect(action.nextState.isSessionHeld).toBe(false)
  })

  it('still releases after grace when persist is on but keep-when-no-host is off', () => {
    const state: PetVoiceHoldState = {
      isSessionHeld: true,
      isAcquiring: false,
      reconnectingSince: 5000,
      lastNotificationText: 'Orca Pet — Reconnecting...'
    }
    const action = decidePetVoiceHoldAction({
      state,
      connectedCount: 0,
      reconnectingCount: 1,
      now: 5000 + PET_VOICE_RECONNECT_GRACE_MS,
      persistEnabled: true,
      keepWhenNoHost: false
    })
    expect(action.type).toBe('release')
  })

  it('persist-on keepWhenNoHost after Pause-after-keepHold still holds when already held', () => {
    const state: PetVoiceHoldState = {
      isSessionHeld: true,
      isAcquiring: false,
      reconnectingSince: null,
      lastNotificationText: 'Pet voice connected'
    }
    expect(persistOnKeepWhenNoHostHoldsAfterKeepHoldPause(true, true, true, true)).toBe(true)
    expect(persistOnKeepWhenNoHostReleasesAfterKeepHoldPause(true, true, true, true)).toBe(false)
    const action = decidePetVoiceHoldAction({
      state,
      connectedCount: 0,
      reconnectingCount: 0,
      now: 5000,
      persistEnabled: true,
      keepWhenNoHost: true,
      afterKeepHoldPause: true
    })
    expect(action.type).toBe('none')
    expect(action.nextState.isSessionHeld).toBe(true)
    const pastGrace = decidePetVoiceHoldAction({
      state: {
        ...state,
        reconnectingSince: 5000,
        lastNotificationText: 'Orca Pet — Reconnecting...'
      },
      connectedCount: 0,
      reconnectingCount: 1,
      now: 5000 + PET_VOICE_RECONNECT_GRACE_MS,
      persistEnabled: true,
      keepWhenNoHost: true,
      afterKeepHoldPause: true
    })
    expect(pastGrace.type).toBe('none')
    expect(pastGrace.nextState.isSessionHeld).toBe(true)
  })

  it('persist-off keepWhenNoHost after Pause-after-keepHold still releases', () => {
    const state: PetVoiceHoldState = {
      isSessionHeld: true,
      isAcquiring: false,
      reconnectingSince: null,
      lastNotificationText: 'Pet voice connected'
    }
    expect(persistOnKeepWhenNoHostReleasesAfterKeepHoldPause(false, true, true, true)).toBe(true)
    const persistOff = decidePetVoiceHoldAction({
      state,
      connectedCount: 0,
      reconnectingCount: 0,
      now: 5000,
      persistEnabled: false,
      keepWhenNoHost: true,
      afterKeepHoldPause: true
    })
    expect(persistOff.type).toBe('release')
    expect(persistOff.nextState.isSessionHeld).toBe(false)
    const keepHostOff = decidePetVoiceHoldAction({
      state,
      connectedCount: 0,
      reconnectingCount: 0,
      now: 5000,
      persistEnabled: true,
      keepWhenNoHost: false,
      afterKeepHoldPause: true
    })
    expect(keepHostOff.type).toBe('release')
    expect(keepHostOff.nextState.isSessionHeld).toBe(false)
  })

  it('persist-on keepWhenNoHost after Pause-after-keepHold does not re-acquire from idle', () => {
    const state: PetVoiceHoldState = {
      isSessionHeld: false,
      isAcquiring: false,
      reconnectingSince: null,
      lastNotificationText: null
    }
    expect(persistOnKeepWhenNoHostDoesNotReacquireAfterKeepHoldPause(true, true, true, false)).toBe(
      true
    )
    expect(persistOnKeepWhenNoHostHoldsAfterKeepHoldPause(true, true, true, false)).toBe(false)
    const action = decidePetVoiceHoldAction({
      state,
      connectedCount: 0,
      reconnectingCount: 0,
      now: 5000,
      persistEnabled: true,
      keepWhenNoHost: true,
      afterKeepHoldPause: true
    })
    expect(action.type).toBe('none')
    expect(action.nextState.isSessionHeld).toBe(false)
    const hostReturns = decidePetVoiceHoldAction({
      state,
      connectedCount: 1,
      reconnectingCount: 0,
      now: 6000,
      persistEnabled: true,
      keepWhenNoHost: true,
      afterKeepHoldPause: true
    })
    expect(hostReturns.type).toBe('acquire')
    const stillTrying = decidePetVoiceHoldAction({
      state,
      connectedCount: 0,
      reconnectingCount: 0,
      stillTryingCount: 1,
      now: 7000,
      persistEnabled: true,
      keepWhenNoHost: true,
      afterKeepHoldPause: true
    })
    expect(stillTrying.type).toBe('acquire')
  })
})
