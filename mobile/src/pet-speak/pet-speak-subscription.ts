import type { RpcClient } from '../transport/rpc-client'
import type { PetSpeakPayload, PetSpeakSubscribeResult } from './pet-speak-payload-validation'
import { PetSpeakHandler } from './pet-speak'
import type { PetSpeakHandlerOptions } from './pet-speak-types'

export function subscribeToPetSpeak(
  client: RpcClient,
  options?: PetSpeakHandlerOptions
): () => void {
  let disposed = false

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

  const unsubscribeStream = client.subscribe('pet.speak.subscribe', {}, (data: unknown) => {
    const event = data as PetSpeakPayload | PetSpeakSubscribeResult | { type: 'end' }
    if (!event || typeof event !== 'object') {
      return
    }

    if (event.type === 'ready') {
      subscriptionId = (event as PetSpeakSubscribeResult).subscriptionId
      if (disposed) {
        unsubscribeServer(subscriptionId)
        unsubscribeStream()
      }
      return
    }

    if (event.type === 'end') {
      if (disposed) {
        unsubscribeStream()
      }
      return
    }

    if (disposed) {
      return
    }

    if (event.type === 'pet.speak') {
      void handler.handleEvent(event as PetSpeakPayload).catch(() => {})
    }
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
    unsubscribeStream()
  }
}
