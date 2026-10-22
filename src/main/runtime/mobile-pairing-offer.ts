import type { MobilePairingConnectionMode } from '../../shared/mobile-pairing-connection-mode'
import type {
  PairingCreateMobileOfferParams,
  PairingCreateMobileOfferResult
} from '../../shared/mobile-pairing-offer-contract'
import {
  getDefaultPairingAddress,
  type DefaultRouteInterfaceLookup
} from './pairing-network-interfaces'
import type { MobilePairingOffer } from './runtime-rpc/runtime-rpc-pairing-types'
import type { MobilePairingOfferRpcContext } from './rpc/core'

export const LOCAL_ONLY_MISSING_ADDRESS_GUIDANCE =
  'No reachable network address is available for pairing. Connect to Wi‑Fi or Tailscale, or pick an address manually.'

type CreateMobilePairingOffer = (args: {
  address?: string | null
  connectionMode?: MobilePairingConnectionMode
  name?: string
  rotate?: boolean
}) => Promise<MobilePairingOffer>

export async function createDesktopMobilePairingOffer(args: {
  createOffer: CreateMobilePairingOffer
  /** The listener's bind host, read only when no address was picked; the picker offers families it serves. */
  getListenerHost: () => string
  address?: string
  rotate?: boolean
  connectionMode?: MobilePairingConnectionMode
  getDefaultRouteInterfaceNames?: DefaultRouteInterfaceLookup
}): Promise<PairingCreateMobileOfferResult> {
  const advertised =
    args.address ??
    (await getDefaultPairingAddress(args.getListenerHost(), args.getDefaultRouteInterfaceNames))
  // Why: LAN-only has no relay fallback, so a missing auto-advertised address must fail closed.
  if (!advertised && args.connectionMode === 'local-only') {
    return {
      available: false,
      reason: 'invalid_advertised_endpoint',
      guidance: LOCAL_ONLY_MISSING_ADDRESS_GUIDANCE
    }
  }

  const offer = await args.createOffer({
    address: advertised,
    connectionMode: args.connectionMode,
    rotate: args.rotate,
    name: `Mobile ${new Date().toLocaleDateString()}`
  })
  if (!offer.available) {
    return {
      available: false,
      reason: offer.reason,
      guidance: offer.guidance,
      ...(offer.relayFailure ? { relayFailure: offer.relayFailure } : {})
    }
  }

  return {
    available: true,
    pairingUrl: offer.pairingUrl,
    // Why: with nothing advertised the factory endpoint is loopback, which is the scanning phone.
    endpoint: advertised ? offer.endpoint : null,
    deviceId: offer.deviceId,
    connectionMode: offer.connectionMode
  }
}

export function registerDesktopMobilePairingOffers(
  rpcServer: {
    setMobilePairingOffers: (hook: MobilePairingOfferRpcContext | null) => void
    createMobilePairingOffer: CreateMobilePairingOffer
    getNetworkExposureBindHost: () => string
  },
  serveOptions: unknown
): void {
  if (serveOptions != null) {
    return
  }
  rpcServer.setMobilePairingOffers({
    create: (params: PairingCreateMobileOfferParams) =>
      createDesktopMobilePairingOffer({
        createOffer: (offerArgs) => rpcServer.createMobilePairingOffer(offerArgs),
        getListenerHost: () => rpcServer.getNetworkExposureBindHost(),
        address: params.address,
        rotate: params.rotate
      })
  })
}
