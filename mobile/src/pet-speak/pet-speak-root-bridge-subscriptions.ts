import type { ConnectionState } from '../transport/types'
import { setHostConnectionRetainRuntime } from './host-connection-retain'
import {
  buildPetSpeechDeviceStatus,
  type PetSpeechDeviceStatusPayload
} from './pet-speech-device-status'
import type { PetSpeechPreferences } from './pet-speech-preferences'
import type { PetSpeakHandlerOptions } from './pet-speak-types'
import {
  clearPetVoiceGraceTimer,
  evaluatePetVoiceHold,
  idlePetVoiceHoldState,
  type PetSpeakSubscriptionEntry,
  type PetVoiceHoldRuntime
} from './pet-speak-root-bridge-hold'
import {
  createPetSpeakSubscriptionRecovery,
  type PetSpeakHostClient
} from './pet-speak-subscription-recovery'

export function wirePetSpeakHostClients(input: {
  isAndroid: boolean
  isEnabled: boolean
  isDisposed: () => boolean
  isEnabledNow: () => boolean
  holdState: PetVoiceHoldRuntime['holdState']
  graceTimer: PetVoiceHoldRuntime['graceTimer']
  currentSubs: Map<string, PetSpeakSubscriptionEntry>
  hostStates: Map<string, ConnectionState>
  speechStates: PetVoiceHoldRuntime['speechStates']
  retryTimers: Map<string, ReturnType<typeof setTimeout>>
  retryAttempts: Map<string, number>
  holdRuntimeRef: { current: PetVoiceHoldRuntime | null }
  ensureNotificationPermissions: PetVoiceHoldRuntime['ensureNotificationPermissions']
  acquireVoiceSession: PetVoiceHoldRuntime['acquireVoiceSession']
  releaseVoiceSession: PetVoiceHoldRuntime['releaseVoiceSession']
  updateVoiceSessionNotification: PetVoiceHoldRuntime['updateVoiceSessionNotification']
  persistEnabled: () => boolean
  keepWhenNoHost: () => boolean
  overlayWhileSpeaking: () => boolean
  keepHostConnection: () => boolean
  handlerOptions: PetSpeakHandlerOptions
  clients: PetSpeakHostClient[]
  preferences: PetSpeechPreferences | null
  reportStatus: (client: PetSpeakHostClient['client'], status: PetSpeechDeviceStatusPayload) => void
}): (() => void) | undefined {
  const holdRuntime: PetVoiceHoldRuntime = {
    isAndroid: input.isAndroid,
    isDisposed: () => input.isDisposed() || !input.isEnabledNow(),
    holdState: input.holdState,
    graceTimer: input.graceTimer,
    currentSubs: input.currentSubs,
    hostStates: input.hostStates,
    speechStates: input.speechStates,
    ensureNotificationPermissions: input.ensureNotificationPermissions,
    acquireVoiceSession: input.acquireVoiceSession,
    releaseVoiceSession: input.releaseVoiceSession,
    updateVoiceSessionNotification: input.updateVoiceSessionNotification,
    persistEnabled: input.persistEnabled,
    keepWhenNoHost: input.keepWhenNoHost,
    overlayWhileSpeaking: input.overlayWhileSpeaking,
    keepHostConnection: input.keepHostConnection,
    petSpeechEnabled: () => input.isEnabledNow()
  }
  input.holdRuntimeRef.current = holdRuntime

  const recovery = createPetSpeakSubscriptionRecovery({
    currentSubs: input.currentSubs,
    speechStates: input.speechStates,
    retryTimers: input.retryTimers,
    retryAttempts: input.retryAttempts,
    handlerOptions: input.handlerOptions,
    isDisposed: input.isDisposed,
    isEnabled: input.isEnabledNow,
    evaluateHold: () => evaluatePetVoiceHold(holdRuntime)
  })

  if (!input.isEnabled) {
    setHostConnectionRetainRuntime(false)
    clearPetVoiceGraceTimer(input.graceTimer)
    recovery.cancelAllRetries()
    for (const sub of input.currentSubs.values()) {
      sub.unsub()
    }
    input.currentSubs.clear()
    input.speechStates.clear()
    const wasHeld = input.holdState.current.isSessionHeld
    input.holdState.current = idlePetVoiceHoldState()
    if (wasHeld) {
      void input.releaseVoiceSession()
    }
    for (const entry of input.clients) {
      if (entry.client.getState() === 'connected') {
        void buildPetSpeechDeviceStatus({ preferences: input.preferences ?? undefined })
          .then((status) => {
            if (entry.client.getState() === 'connected') {
              input.reportStatus(entry.client, status)
            }
          })
          .catch(() => {})
      }
    }
    return
  }

  const cleanups = input.clients.map((entry) => {
    const wireUp = (state: ConnectionState) => {
      const previous = input.hostStates.get(entry.hostId)
      input.hostStates.set(entry.hostId, state)
      let subscriptionChanged = false
      if (state === 'connected' && input.isEnabled) {
        if (
          !input.currentSubs.has(entry.hostId) ||
          input.currentSubs.get(entry.hostId)?.client !== entry.client
        ) {
          input.currentSubs.get(entry.hostId)?.unsub()
          input.currentSubs.delete(entry.hostId)
          recovery.startSubscription(entry)
          subscriptionChanged = true
        }
      } else {
        const sub = input.currentSubs.get(entry.hostId)
        if (sub && sub.client === entry.client) {
          sub.unsub()
          input.currentSubs.delete(entry.hostId)
          subscriptionChanged = true
        }
        recovery.cancelRetry(entry.hostId)
        input.speechStates.set(
          entry.hostId,
          state === 'reconnecting' || state === 'connecting' || state === 'handshaking'
            ? 'reconnecting'
            : 'disabled'
        )
      }
      if (previous !== state || subscriptionChanged) {
        evaluatePetVoiceHold(holdRuntime)
      }
    }

    wireUp(entry.client.getState())
    return entry.client.onStateChange(wireUp)
  })

  const activeHostIds = new Set(input.clients.map((entry) => entry.hostId))
  let removedAny = false
  for (const [hostId, sub] of Array.from(input.currentSubs.entries())) {
    if (!activeHostIds.has(hostId)) {
      sub.unsub()
      input.currentSubs.delete(hostId)
      recovery.cancelRetry(hostId)
      input.retryAttempts.delete(hostId)
      input.speechStates.delete(hostId)
      removedAny = true
    }
  }
  for (const hostId of Array.from(input.hostStates.keys())) {
    if (!activeHostIds.has(hostId)) {
      input.hostStates.delete(hostId)
      recovery.cancelRetry(hostId)
      input.retryAttempts.delete(hostId)
      input.speechStates.delete(hostId)
      removedAny = true
    }
  }
  if (removedAny) {
    evaluatePetVoiceHold(holdRuntime)
  }

  return () => {
    for (const cleanup of cleanups) {
      cleanup()
    }
  }
}
