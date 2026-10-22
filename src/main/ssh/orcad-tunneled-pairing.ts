import { encodePairingOffer, parsePairingCode, type PairingOffer } from '../../shared/pairing'
import type { ServeReadiness } from '../server/serve-readiness'

export function tunneledOrcadPairingCode(
  readiness: ServeReadiness,
  localPort: number,
  pairedOffer?: PairingOffer | null
): string {
  if (!pairedOffer && !readiness.pairing.available) {
    throw new Error(
      `This host’s Orca server did not publish a pairing offer: ${readiness.pairing.guidance}`
    )
  }
  // An enrolled client keeps its grant; startup offers are for new clients.
  const offer =
    pairedOffer ?? (readiness.pairing.available ? parsePairingCode(readiness.pairing.url) : null)
  if (!offer) {
    throw new Error('This host’s Orca server published an invalid pairing offer.')
  }
  const endpoint = new URL(offer.endpoint)
  if (endpoint.protocol !== 'ws:' && endpoint.protocol !== 'wss:') {
    throw new Error('This host’s Orca server pairing endpoint is not a WebSocket URL.')
  }
  // Mac always uses the SSH local forward. Advertised host (LAN/public) is for other clients.
  endpoint.protocol = 'ws:'
  endpoint.hostname = '127.0.0.1'
  endpoint.port = String(localPort)
  return encodePairingOffer({ ...offer, endpoint: endpoint.toString() })
}
