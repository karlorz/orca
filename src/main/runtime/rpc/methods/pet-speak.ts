import { z } from 'zod'
import { defineStreamingMethod, defineMethod, type RpcAnyMethod } from '../core'
import type { ReplayablePetSpeakEvent } from '../../pet-speak-replay'

let petSpeakSubscriptionSeq = 0

const PetSpeechStatusSchema = z.object({
  installUuid: z.string().min(1, 'Missing installUuid'),
  modelName: z.string().min(1, 'Missing modelName'),
  enabled: z.boolean(),
  availability: z.enum(['available', 'disabled', 'unavailable']),
  activeEngine: z.string().optional(),
  supportedLanguages: z.array(z.string()).optional(),
  currentLanguage: z.string().optional(),
  selectedVoice: z.string().optional(),
  rate: z.number().optional(),
  lastOutcome: z.string().optional(),
  updatedAt: z.number().optional()
})

const PetSpeakSubscribeParams = z.object({
  last_seen_seq: z.number().int().min(0, 'last_seen_seq must be a non-negative integer').optional(),
  epoch: z.string().optional(),
  status: PetSpeechStatusSchema.optional()
})

const PetSpeakStatusParams = PetSpeechStatusSchema

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
    params: PetSpeakSubscribeParams,
    handler: async (params, { runtime, connectionId }, emit) => {
      await new Promise<void>((resolve) => {
        let isDisposed = false
        const seq = ++petSpeakSubscriptionSeq
        const subscriptionId = `pet-speak-${connectionId ?? 'inproc'}-${seq}`
        const tracker = runtime.getPetVoiceSubscriptionTracker?.()
        const releaseTracker = tracker?.registerSubscription(subscriptionId)

        const teardown = (eventId?: string) => {
          if (isDisposed) {
            return
          }
          isDisposed = true
          releaseTracker?.()
          unsubscribe()
          if (eventId && runtime.handlePetSpeakComplete) {
            void runtime.handlePetSpeakComplete(eventId, 'voice-unavailable').catch(() => {})
          }
          resolve()
        }

        const safeEmit = (data: unknown, eventId?: string): boolean => {
          if (isDisposed) {
            return false
          }
          try {
            emit(data)
            return true
          } catch {
            teardown(eventId)
            return false
          }
        }

        const unsubscribe =
          runtime.onPetSpeakDispatched?.((event: ReplayablePetSpeakEvent) => {
            safeEmit(event, event.event_id)
          }) ?? (() => {})

        runtime.registerSubscriptionCleanup(
          subscriptionId,
          () => {
            if (isDisposed) {
              return
            }
            safeEmit({ type: 'end' })
            teardown()
          },
          connectionId
        )

        // If client provided additive status during subscribe, report it
        if (params?.status && runtime.handlePetSpeechStatus) {
          void runtime.handlePetSpeechStatus(params.status, connectionId).catch(() => {})
        }

        // 1. Emit ready frame with subscriptionId and epoch
        const epoch = runtime.getPetSpeakEpoch?.()
        if (!safeEmit({ type: 'ready', subscriptionId, epoch })) {
          return
        }

        // 2. Replay missed events if client is catching up
        if (
          params?.last_seen_seq !== undefined &&
          params?.epoch &&
          runtime.getMissedPetSpeakSince
        ) {
          const missed = runtime.getMissedPetSpeakSince(params.last_seen_seq, params.epoch)
          for (const event of missed) {
            if (!safeEmit(event, event.event_id)) {
              return
            }
          }
        }
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
  }),
  defineMethod({
    name: 'pet.speak.status',
    params: PetSpeakStatusParams,
    handler: async (params, { runtime, connectionId }) => {
      if (runtime.handlePetSpeechStatus) {
        return await runtime.handlePetSpeechStatus(params, connectionId)
      }
      return { acknowledged: true }
    }
  })
]
