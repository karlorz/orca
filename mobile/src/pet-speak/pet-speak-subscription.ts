import type { RpcClient } from '../transport/rpc-client'
import type { PetSpeakPayload, PetSpeakSubscribeResult } from './pet-speak-payload-validation'
import { PetSpeakHandler } from './pet-speak'
import type { PetSpeakHandlerOptions } from './pet-speak-types'
import { loadPetSpeakWatermark, savePetSpeakWatermark } from './pet-speak-watermark'
import {
  buildPetSpeechDeviceStatus,
  type PetSpeechDeviceStatusPayload
} from './pet-speech-device-status'

export interface SubscribeToPetSpeakOptions extends PetSpeakHandlerOptions {
  status?: PetSpeechDeviceStatusPayload
  onReady?: () => void
  onTerminal?: (reason: 'end' | 'error') => void
  resumeMissed?: boolean
}

export function subscribeToPetSpeak(
  client: RpcClient,
  options?: SubscribeToPetSpeakOptions,
  hostId?: string
): () => void {
  let disposed = false
  const targetHostId = hostId ?? 'default'

  const handler = new PetSpeakHandler({
    ...options,
    onAccepted: async (eventId) => {
      void options?.onAccepted?.(eventId).catch(() => {})
      if (client.getState() === 'connected') {
        await client
          .sendRequest('pet.speak.accepted', {
            event_id: eventId
          })
          .catch(() => {})
      }
    },
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

        // Additive: update device status outcome on the connection
        void buildPetSpeechDeviceStatus({ lastOutcome: outcome })
          .then((status) => {
            if (client.getState() === 'connected' && !disposed) {
              client.sendRequest('pet.speak.status', status).catch(() => {})
            }
          })
          .catch(() => {})
      }
    }
  })

  let subscriptionId: string | null = null
  let readyReported = false
  let terminalReported = false

  function unsubscribeServer(id: string) {
    if (client.getState() === 'connected') {
      client.sendRequest('pet.speak.unsubscribe', { subscriptionId: id }).catch(() => {})
    }
  }

  let unsubscribeStream: (() => void) | null = null

  const initializeSubscription = async () => {
    let watermark: { stored: boolean; seq: number; epoch: string | null } = {
      stored: false,
      seq: 0,
      epoch: ''
    }
    try {
      watermark = await loadPetSpeakWatermark(targetHostId)
    } catch {}

    if (disposed) {
      return
    }

    const params: Record<string, unknown> =
      options?.resumeMissed !== false && watermark.stored && watermark.seq > 0 && watermark.epoch
        ? { last_seen_seq: watermark.seq, epoch: watermark.epoch }
        : {}

    unsubscribeStream = client.subscribe('pet.speak.subscribe', params, (data: unknown) => {
      const event = data as
        | PetSpeakPayload
        | PetSpeakSubscribeResult
        | { type: 'end' }
        | { type: 'error'; message?: string }
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
        } else if (!readyReported) {
          readyReported = true
          options?.onReady?.()
          void Promise.resolve(options?.status)
            .then((status) => status ?? buildPetSpeechDeviceStatus())
            .then((freshStatus) => {
              if (client.getState() === 'connected' && !disposed) {
                client.sendRequest('pet.speak.status', freshStatus).catch(() => {})
              }
            })
            .catch(() => {})
        }
        return
      }

      if (event.type === 'end' || event.type === 'error') {
        if (disposed) {
          unsubscribeStream?.()
        } else if (!terminalReported) {
          terminalReported = true
          options?.onTerminal?.(event.type)
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
  }

  void initializeSubscription()

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
