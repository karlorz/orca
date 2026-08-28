export const PET_VOICE_RECONNECT_GRACE_MS = 5 * 60 * 1000
export const PET_VOICE_CONNECTED_TEXT = 'Pet voice connected'
export const PET_VOICE_RECONNECTING_TEXT = 'Orca Pet — Reconnecting...'

export interface PetVoiceHoldState {
  isSessionHeld: boolean
  isAcquiring: boolean
  reconnectingSince: number | null
  lastNotificationText: string | null
}

export type PetVoiceHoldAction =
  | {
      type: 'acquire'
      notificationText: string
      nextState: PetVoiceHoldState
    }
  | {
      type: 'update-notification'
      notificationText: string
      nextState: PetVoiceHoldState
    }
  | {
      type: 'release'
      nextState: PetVoiceHoldState
    }
  | {
      type: 'none'
      nextState: PetVoiceHoldState
    }

export interface DecidePetVoiceHoldParams {
  state: PetVoiceHoldState
  connectedCount: number
  reconnectingCount: number
  stillTryingCount?: number
  now: number
}

export function decidePetVoiceHoldAction(params: DecidePetVoiceHoldParams): PetVoiceHoldAction {
  const { state, connectedCount, reconnectingCount, stillTryingCount, now } = params
  const activeTryingCount = stillTryingCount ?? reconnectingCount

  if (connectedCount > 0) {
    if (!state.isSessionHeld && !state.isAcquiring) {
      return {
        type: 'acquire',
        notificationText: PET_VOICE_CONNECTED_TEXT,
        nextState: {
          ...state,
          isAcquiring: true,
          reconnectingSince: null
        }
      }
    }

    if (state.isSessionHeld) {
      if (state.lastNotificationText !== PET_VOICE_CONNECTED_TEXT) {
        return {
          type: 'update-notification',
          notificationText: PET_VOICE_CONNECTED_TEXT,
          nextState: {
            ...state,
            reconnectingSince: null,
            lastNotificationText: PET_VOICE_CONNECTED_TEXT
          }
        }
      }
      if (state.reconnectingSince !== null) {
        return {
          type: 'none',
          nextState: {
            ...state,
            reconnectingSince: null
          }
        }
      }
    }

    return {
      type: 'none',
      nextState: state
    }
  }

  // connectedCount === 0
  if (activeTryingCount > 0 && state.isSessionHeld) {
    const reconnectingSince = state.reconnectingSince ?? now
    const elapsed = now - reconnectingSince

    if (elapsed >= PET_VOICE_RECONNECT_GRACE_MS) {
      return {
        type: 'release',
        nextState: {
          isSessionHeld: false,
          isAcquiring: false,
          reconnectingSince: null,
          lastNotificationText: null
        }
      }
    }

    if (state.lastNotificationText !== PET_VOICE_RECONNECTING_TEXT) {
      return {
        type: 'update-notification',
        notificationText: PET_VOICE_RECONNECTING_TEXT,
        nextState: {
          ...state,
          reconnectingSince,
          lastNotificationText: PET_VOICE_RECONNECTING_TEXT
        }
      }
    }

    return {
      type: 'none',
      nextState: {
        ...state,
        reconnectingSince
      }
    }
  }

  // 0 connected, and (activeTryingCount === 0 or not held)
  if (state.isSessionHeld) {
    return {
      type: 'release',
      nextState: {
        isSessionHeld: false,
        isAcquiring: false,
        reconnectingSince: null,
        lastNotificationText: null
      }
    }
  }

  return {
    type: 'none',
    nextState: state
  }
}
