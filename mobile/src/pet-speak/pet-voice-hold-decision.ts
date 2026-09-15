import { persistOffOverlayAfterKeepHoldPauseNeverHoldsSession } from './pet-speech-overlay-hold-decision'

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
  persistEnabled?: boolean
  keepWhenNoHost?: boolean
  overlayWhileSpeaking?: boolean
  afterKeepHoldPause?: boolean
}

export function persistOnKeepWhenNoHostHoldsAfterKeepHoldPause(
  persistEnabled: boolean,
  keepWhenNoHost: boolean,
  afterKeepHoldPause: boolean,
  sessionHeld: boolean
): boolean {
  return afterKeepHoldPause && persistEnabled && keepWhenNoHost && sessionHeld
}

export function persistOnKeepWhenNoHostReleasesAfterKeepHoldPause(
  persistEnabled: boolean,
  keepWhenNoHost: boolean,
  afterKeepHoldPause: boolean,
  sessionHeld: boolean
): boolean {
  return afterKeepHoldPause && sessionHeld && !(persistEnabled && keepWhenNoHost)
}

export function persistOnKeepWhenNoHostDoesNotReacquireAfterKeepHoldPause(
  persistEnabled: boolean,
  keepWhenNoHost: boolean,
  afterKeepHoldPause: boolean,
  sessionHeld: boolean
): boolean {
  return afterKeepHoldPause && persistEnabled && keepWhenNoHost && !sessionHeld
}

export function persistOnOverlayJsReleaseEvaluateDoesNotReacquire(
  persistEnabled: boolean,
  overlayWhileSpeaking: boolean,
  afterKeepHoldPause: boolean,
  sessionHeld: boolean
): boolean {
  return persistEnabled && overlayWhileSpeaking && afterKeepHoldPause && !sessionHeld
}

export function decidePetVoiceHoldAction(params: DecidePetVoiceHoldParams): PetVoiceHoldAction {
  const {
    state,
    connectedCount,
    reconnectingCount,
    stillTryingCount,
    now,
    persistEnabled = false,
    keepWhenNoHost = false,
    overlayWhileSpeaking = false,
    afterKeepHoldPause = false
  } = params
  const overlayBlocksHold = persistOffOverlayAfterKeepHoldPauseNeverHoldsSession(
    persistEnabled,
    overlayWhileSpeaking,
    afterKeepHoldPause
  )
  const keepIdleWithoutHost = persistEnabled && keepWhenNoHost
  const holdAfterPause = persistOnKeepWhenNoHostHoldsAfterKeepHoldPause(
    persistEnabled,
    keepWhenNoHost,
    afterKeepHoldPause,
    state.isSessionHeld
  )
  const releaseAfterPause = persistOnKeepWhenNoHostReleasesAfterKeepHoldPause(
    persistEnabled,
    keepWhenNoHost,
    afterKeepHoldPause,
    state.isSessionHeld
  )
  const noReacquireAfterPause = persistOnKeepWhenNoHostDoesNotReacquireAfterKeepHoldPause(
    persistEnabled,
    keepWhenNoHost,
    afterKeepHoldPause,
    state.isSessionHeld
  )
  const activeTryingCount = stillTryingCount ?? reconnectingCount

  if (connectedCount > 0) {
    if (!state.isSessionHeld && !state.isAcquiring && !overlayBlocksHold) {
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
  if (activeTryingCount > 0 && !state.isSessionHeld && !state.isAcquiring && !overlayBlocksHold) {
    return {
      type: 'acquire',
      notificationText: PET_VOICE_RECONNECTING_TEXT,
      nextState: {
        ...state,
        isAcquiring: true,
        reconnectingSince: state.reconnectingSince ?? now
      }
    }
  }

  if (activeTryingCount > 0 && state.isSessionHeld) {
    const reconnectingSince = state.reconnectingSince ?? now
    const elapsed = now - reconnectingSince

    if (elapsed >= PET_VOICE_RECONNECT_GRACE_MS && !keepIdleWithoutHost && !holdAfterPause) {
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
  if ((state.isSessionHeld && !keepIdleWithoutHost) || releaseAfterPause) {
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

  if (holdAfterPause || noReacquireAfterPause) {
    return {
      type: 'none',
      nextState: state
    }
  }

  return {
    type: 'none',
    nextState: state
  }
}
