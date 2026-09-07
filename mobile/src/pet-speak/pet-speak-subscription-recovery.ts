import type { RpcClient } from '../transport/rpc-client'
import type { PetSpeakHandlerOptions } from './pet-speak-types'
import { subscribeToPetSpeak } from './pet-speak-subscription'
import type { PetSpeakSessionState, PetSpeakSubscriptionEntry } from './pet-speak-root-bridge-hold'

export const PET_SPEAK_RETRY_DELAYS_MS = [1000, 2000, 5000, 15_000, 30_000] as const

export type PetSpeakHostClient = { hostId: string; client: RpcClient }

type PetSpeakRecoveryRuntime = {
  currentSubs: Map<string, PetSpeakSubscriptionEntry>
  speechStates: Map<string, PetSpeakSessionState>
  retryTimers: Map<string, ReturnType<typeof setTimeout>>
  retryAttempts: Map<string, number>
  handlerOptions: PetSpeakHandlerOptions
  isDisposed: () => boolean
  isEnabled: () => boolean
  evaluateHold: () => void
}

export function createPetSpeakSubscriptionRecovery(runtime: PetSpeakRecoveryRuntime): {
  cancelRetry: (hostId: string) => void
  cancelAllRetries: () => void
  scheduleRetry: (entry: PetSpeakHostClient) => void
  startSubscription: (entry: PetSpeakHostClient) => void
} {
  function cancelRetry(hostId: string): void {
    const timer = runtime.retryTimers.get(hostId)
    if (timer !== undefined) {
      clearTimeout(timer)
      runtime.retryTimers.delete(hostId)
    }
  }

  function cancelAllRetries(): void {
    for (const timer of runtime.retryTimers.values()) {
      clearTimeout(timer)
    }
    runtime.retryTimers.clear()
    runtime.retryAttempts.clear()
  }

  function scheduleRetry(entry: PetSpeakHostClient): void {
    if (runtime.retryTimers.has(entry.hostId)) {
      return
    }
    const attempt = runtime.retryAttempts.get(entry.hostId) ?? 0
    if (attempt >= PET_SPEAK_RETRY_DELAYS_MS.length) {
      runtime.speechStates.set(entry.hostId, 'disabled')
      runtime.evaluateHold()
      return
    }
    runtime.speechStates.set(entry.hostId, 'reconnecting')
    runtime.evaluateHold()
    const delay = PET_SPEAK_RETRY_DELAYS_MS[attempt]
    runtime.retryAttempts.set(entry.hostId, attempt + 1)
    const timer = setTimeout(() => {
      runtime.retryTimers.delete(entry.hostId)
      if (
        runtime.isDisposed() ||
        !runtime.isEnabled() ||
        entry.client.getState() !== 'connected' ||
        runtime.currentSubs.has(entry.hostId)
      ) {
        return
      }
      startSubscription(entry)
    }, delay)
    runtime.retryTimers.set(entry.hostId, timer)
  }

  function startSubscription(entry: PetSpeakHostClient): void {
    cancelRetry(entry.hostId)
    const resumeMissed = runtime.speechStates.get(entry.hostId) !== 'reconnecting'
    const token: PetSpeakSubscriptionEntry = { client: entry.client, unsub: () => {} }
    runtime.currentSubs.set(entry.hostId, token)
    runtime.speechStates.set(entry.hostId, 'connecting')
    runtime.evaluateHold()
    const unsub = subscribeToPetSpeak(
      entry.client,
      {
        ...runtime.handlerOptions,
        resumeMissed,
        onReady: () => {
          if (
            runtime.currentSubs.get(entry.hostId) !== token ||
            entry.client.getState() !== 'connected'
          ) {
            return
          }
          runtime.retryAttempts.delete(entry.hostId)
          runtime.speechStates.set(entry.hostId, 'ready')
          runtime.evaluateHold()
        },
        onTerminal: () => {
          if (runtime.currentSubs.get(entry.hostId) !== token) {
            return
          }
          runtime.currentSubs.delete(entry.hostId)
          token.unsub()
          if (entry.client.getState() === 'connected' && runtime.isEnabled()) {
            scheduleRetry(entry)
          } else {
            runtime.speechStates.set(entry.hostId, 'disabled')
            runtime.evaluateHold()
          }
        }
      },
      entry.hostId
    )
    if (runtime.currentSubs.get(entry.hostId) === token) {
      token.unsub = unsub
    } else {
      unsub()
    }
  }

  return { cancelRetry, cancelAllRetries, scheduleRetry, startSubscription }
}
