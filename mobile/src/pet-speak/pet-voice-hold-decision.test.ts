import { describe, expect, it } from 'vitest'
import {
  decidePetVoiceHoldAction,
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
})
