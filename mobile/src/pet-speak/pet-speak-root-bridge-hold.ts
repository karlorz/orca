import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import {
  decidePetVoiceHoldAction,
  PET_VOICE_RECONNECT_GRACE_MS,
  type PetVoiceHoldState
} from './pet-voice-hold-decision'

export type PetSpeakSubscriptionEntry = { client: RpcClient; unsub: () => void }

export type PetVoiceHoldRuntime = {
  isAndroid: boolean
  isDisposed: () => boolean
  holdState: { current: PetVoiceHoldState }
  graceTimer: { current: ReturnType<typeof setTimeout> | null }
  currentSubs: Map<string, PetSpeakSubscriptionEntry>
  hostStates: Map<string, ConnectionState>
  ensureNotificationPermissions: () => Promise<boolean>
  acquireVoiceSession: () => Promise<{ held: boolean }>
  releaseVoiceSession: () => Promise<void>
  updateVoiceSessionNotification: (text: string) => Promise<void>
}

export function idlePetVoiceHoldState(): PetVoiceHoldState {
  return {
    isSessionHeld: false,
    isAcquiring: false,
    reconnectingSince: null,
    lastNotificationText: null
  }
}

export function clearPetVoiceGraceTimer(graceTimer: PetVoiceHoldRuntime['graceTimer']): void {
  if (graceTimer.current !== null) {
    clearTimeout(graceTimer.current)
    graceTimer.current = null
  }
}

export function evaluatePetVoiceHold(runtime: PetVoiceHoldRuntime, now: number = Date.now()): void {
  if (!runtime.isAndroid || runtime.isDisposed()) {
    return
  }

  const connectedCount = runtime.currentSubs.size
  let reconnectingCount = 0
  let stillTryingCount = 0
  for (const state of runtime.hostStates.values()) {
    if (state === 'reconnecting') {
      reconnectingCount++
    }
    if (state === 'reconnecting' || state === 'connecting' || state === 'handshaking') {
      stillTryingCount++
    }
  }

  const action = decidePetVoiceHoldAction({
    state: runtime.holdState.current,
    connectedCount,
    reconnectingCount,
    stillTryingCount,
    now
  })

  runtime.holdState.current = action.nextState

  const reconnectingSince = action.nextState.reconnectingSince
  if (reconnectingSince === null) {
    clearPetVoiceGraceTimer(runtime.graceTimer)
  } else if (runtime.graceTimer.current === null) {
    const remaining = Math.max(0, PET_VOICE_RECONNECT_GRACE_MS - (now - reconnectingSince))
    runtime.graceTimer.current = setTimeout(() => {
      runtime.graceTimer.current = null
      evaluatePetVoiceHold(runtime, Date.now())
    }, remaining)
  }

  if (action.type === 'acquire') {
    void runtime.ensureNotificationPermissions().then((granted) => {
      if (granted && !runtime.isDisposed()) {
        void runtime.acquireVoiceSession().then((res) => {
          if (runtime.isDisposed()) {
            runtime.holdState.current = idlePetVoiceHoldState()
            if (res.held) {
              void runtime.releaseVoiceSession()
            }
            return
          }
          runtime.holdState.current = {
            ...runtime.holdState.current,
            isAcquiring: false,
            isSessionHeld: res.held,
            lastNotificationText: res.held
              ? (runtime.holdState.current.lastNotificationText ?? action.notificationText)
              : null
          }
          if (res.held) {
            evaluatePetVoiceHold(runtime)
          }
        })
      } else {
        runtime.holdState.current = {
          ...runtime.holdState.current,
          isAcquiring: false
        }
      }
    })
  } else if (action.type === 'update-notification') {
    void runtime.updateVoiceSessionNotification(action.notificationText)
  } else if (action.type === 'release') {
    void runtime.releaseVoiceSession()
  }
}
