import type { RpcClient } from '../transport/rpc-client'
import type { PetSpeakPayload, PetSpeakSubscribeResult } from './pet-speak-payload-validation'
import { PetSpeakHandler } from './pet-speak'
import type { PetSpeakHandlerOptions } from './pet-speak-types'
import { loadPetSpeakWatermark, savePetSpeakWatermark } from './pet-speak-watermark'

export function subscribeToPetSpeak(
  client: RpcClient,
  options?: PetSpeakHandlerOptions,
  hostId?: string
): () => void {
  let disposed = false
  const targetHostId = hostId ?? 'default'

  const handler = new PetSpeakHandler({
    ...options,
    onComplete: async (eventId, outcome) => {
      if (options?.onComplete) {
        await options.onComplete(eventId, outcome).catch(() => {})
      }
      if (client.getState() === 'connected') {
        await client
          .sendRequest('pet.speak.complete', {
            event_id: eventId,
            outcome
          })
          .catch(() => {})
      }
    }
  })

  let subscriptionId: string | null = null

  function unsubscribeServer(id: string) {
    if (client.getState() === 'connected') {
      client.sendRequest('pet.speak.unsubscribe', { subscriptionId: id }).catch(() => {})
    }
  }

  let unsubscribeStream: (() => void) | null = null

  void loadPetSpeakWatermark(targetHostId).then((watermark) => {
    if (disposed) {
      return
    }

    const params =
      watermark.stored && watermark.seq > 0 && watermark.epoch
        ? { last_seen_seq: watermark.seq, epoch: watermark.epoch }
        : {}

    unsubscribeStream = client.subscribe('pet.speak.subscribe', params, (data: unknown) => {
      const event = data as PetSpeakPayload | PetSpeakSubscribeResult | { type: 'end' }
      if (!event || typeof event !== 'object') {
        return
      }

      if (event.type === 'ready') {
        subscriptionId = (event as PetSpeakSubscribeResult).subscriptionId
        if (disposed) {
          if (subscriptionId) {
            unsubscribeServer(subscriptionId)
          }
          unsubscribeStream?.()
        }
        return
      }

      if (event.type === 'end') {
        if (disposed) {
          unsubscribeStream?.()
        }
        return
      }

      if (disposed) {
        return
      }

      if (event.type === 'pet.speak') {
        const payload = event as PetSpeakPayload
        if (payload.seq !== undefined && payload.epoch) {
          void savePetSpeakWatermark(targetHostId, { seq: payload.seq, epoch: payload.epoch })
        }
        void handler.handleEvent(payload).catch(() => {})
      }
    })
  })

  return () => {
    if (disposed) {
      return
    }
    disposed = true
    handler.dispose()
    if (subscriptionId) {
      unsubscribeServer(subscriptionId)
    }
    unsubscribeStream?.()
  }
}
