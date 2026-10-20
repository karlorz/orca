import { z } from 'zod'

export const RUNTIME_PAIRING_CREATE_OFFER_METHOD = 'pairing.createOffer'
export const RUNTIME_PAIRING_OFFER_UNAVAILABLE_CODE = 'runtime_pairing_offer_unavailable'

export const PairingCreateRuntimeOfferParamsSchema = z
  .object({
    address: z
      .string()
      .trim()
      .min(1, 'address must be a non-empty hostname, IP, or WebSocket URL')
      .optional(),
    rotate: z.boolean().optional()
  })
  .strict()

export type PairingCreateRuntimeOfferParams = z.infer<typeof PairingCreateRuntimeOfferParamsSchema>

export type PairingCreateRuntimeOfferAvailable = {
  available: true
  pairingUrl: string
  endpoint: string
  deviceId: string
  webClientUrl: string | null
}

export type PairingCreateRuntimeOfferUnavailable = {
  available: false
  reason: string
  guidance: string
}

export type PairingCreateRuntimeOfferResult =
  | PairingCreateRuntimeOfferAvailable
  | PairingCreateRuntimeOfferUnavailable
