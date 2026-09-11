import type { RpcClient } from '../transport/rpc-client'
import type { PetSpeakPayload, PetSpeakSubscribeResult } from './pet-speak-payload-validation'
import { PetSpeakHandler } from './pet-speak'
import type { PetSpeakHandlerOptions } from './pet-speak-types'
import { loadPetSpeakWatermark, savePetSpeakWatermark } from './pet-speak-watermark'
import {
  admissionDecisionFromRpcResponse,
  compactBoundaryTimestamps,
  normalizeAdmissionDecision,
  stampBoundary,
  type PetSpeakBoundaryTimestamps
} from './pet-speak-observability'
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
    crossHostOwnerId: options?.crossHostOwnerId ?? targetHostId,
    onAccepted: async (eventId, timestamps) => {
      if (options?.onAccepted) {
        const accepted = await options.onAccepted(eventId, timestamps).catch(() => false)
        const decision = normalizeAdmissionDecision(accepted)
        if (!decision.accepted) {
          return decision
        }
      }
      if (client.getState() !== 'connected') {
        return { accepted: false, reason: 'disconnection' as const }
      }
      const trace: PetSpeakBoundaryTimestamps = { ...timestamps }
      stampBoundary(trace, 'acceptance_send')
      const compact = compactBoundaryTimestamps(trace)
      try {
        const response = await client.sendRequest('pet.speak.accepted', {
          event_id: eventId,
          ...(compact ? { timestamps: compact } : {})
        })
        return admissionDecisionFromRpcResponse(response)
      } catch {
        return { accepted: false, reason: 'transport_teardown' as const }
      }
    },
    onComplete: async (eventId, outcome, reason, timestamps) => {
      if (options?.onComplete) {
        await options.onComplete(eventId, outcome, reason, timestamps).catch(() => {})
      }
      if (client.getState() === 'connected') {
        const compact = compactBoundaryTimestamps(timestamps)
        await client
          .sendRequest('pet.speak.complete', {
            event_id: eventId,
            outcome,
            ...(reason ? { reason } : {}),
            ...(compact ? { timestamps: compact } : {})
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
        void handler.handleEvent(payload, { socketReceivedAt: Date.now() }).catch(() => {})
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
