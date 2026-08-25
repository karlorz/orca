import { z } from 'zod'
import { defineStreamingMethod, defineMethod, type RpcAnyMethod } from '../core'

let petSpeakSubscriptionSeq = 0

const PetSpeakUnsubscribeParams = z.object({
  subscriptionId: z
    .unknown()
    .transform((value) => (typeof value === 'string' && value.length > 0 ? value : ''))
    .pipe(z.string().min(1, 'Missing subscriptionId'))
})

const PetSpeakCompleteParams = z.object({
  event_id: z
    .string()
    .min(1, 'Missing event_id')
    .refine((id) => Array.from(id).length <= 128, 'event_id exceeds 128 Unicode characters'),
  outcome: z.enum(['spoken', 'voice-unavailable', 'playback-error', 'cancelled'])
})

export const PET_SPEAK_METHODS: readonly RpcAnyMethod[] = [
  defineStreamingMethod({
    name: 'pet.speak.subscribe',
    params: null,
    handler: async (_params, { runtime, connectionId }, emit) => {
      await new Promise<void>((resolve) => {
        const unsubscribe =
          runtime.onPetSpeakDispatched?.((event) => {
            emit(event)
          }) ?? (() => {})

        const seq = ++petSpeakSubscriptionSeq
        const subscriptionId = `pet-speak-${connectionId ?? 'inproc'}-${seq}`
        const tracker = runtime.getPetVoiceSubscriptionTracker?.()
        const releaseTracker = tracker?.registerSubscription(subscriptionId)

        runtime.registerSubscriptionCleanup(
          subscriptionId,
          () => {
            releaseTracker?.()
            unsubscribe()
            emit({ type: 'end' })
            resolve()
          },
          connectionId
        )

        emit({ type: 'ready', subscriptionId })
      })
    }
  }),
  defineMethod({
    name: 'pet.speak.unsubscribe',
    params: PetSpeakUnsubscribeParams,
    handler: async (params, { runtime, connectionId }) => {
      // Why: client-supplied unsubscribe must not tear down streams owned by other or newer connections.
      const unsubscribed = runtime.cleanupSubscriptionIfOwnedByConnection(
        params.subscriptionId,
        connectionId
      )
      return { unsubscribed }
    }
  }),
  defineMethod({
    name: 'pet.speak.complete',
    params: PetSpeakCompleteParams,
    handler: async (params, { runtime }) => {
      if (runtime.handlePetSpeakComplete) {
        return await runtime.handlePetSpeakComplete(params.event_id, params.outcome)
      }
      return { completed: false }
    }
  })
]
