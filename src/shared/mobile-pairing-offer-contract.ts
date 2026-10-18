import { z } from 'zod'
import type { MobilePairingConnectionMode } from './mobile-pairing-connection-mode'
import type { MobileRelayMintFailure } from './mobile-relay-mint-failure'

export const MOBILE_PAIRING_CREATE_OFFER_METHOD = 'pairing.createMobileOffer'
export const MOBILE_PAIRING_OFFER_UNAVAILABLE_CODE = 'mobile_pairing_offer_unavailable'

export const PairingCreateMobileOfferParamsSchema = z
  .object({
    address: z
      .string()
      .trim()
      .min(1, 'address must be a non-empty hostname, IP, or WebSocket URL')
      .optional(),
    rotate: z.boolean().optional()
  })
  .strict()

export type PairingCreateMobileOfferParams = z.infer<typeof PairingCreateMobileOfferParamsSchema>

export type PairingCreateMobileOfferAvailable = {
  available: true
  pairingUrl: string
  endpoint: string | null
  deviceId: string
  connectionMode: MobilePairingConnectionMode
}

export type PairingCreateMobileOfferUnavailable = {
  available: false
  reason: string
  guidance: string
  relayFailure?: MobileRelayMintFailure
}

export type PairingCreateMobileOfferResult =
  | PairingCreateMobileOfferAvailable
  | PairingCreateMobileOfferUnavailable
