import { describe, expect, it } from 'vitest'
import {
  encodePairingOffer,
  parsePairingCode,
  PAIRING_OFFER_VERSION,
  type PairingOffer
} from '../../shared/pairing'
import type { ServeReadiness } from '../server/serve-readiness'
import { tunneledOrcadPairingCode } from './orcad-tunneled-pairing'

function readiness(endpoint = 'ws://[::1]:6768/runtime?mode=paired#fragment'): ServeReadiness {
  return {
    runtimeId: 'runtime-1',
    boundEndpoint: 'ws://127.0.0.1:6768',
    advertisedEndpoint: null,
    managedWslCliReconciliation: 'settled',
    pairing: {
      available: true,
      url: encodePairingOffer({
        v: PAIRING_OFFER_VERSION,
        endpoint,
        deviceToken: 'device-token',
        publicKeyB64: 'public-key',
        pairedDeviceId: 'device-1'
      }),
      endpoint,
      deviceId: 'device-1',
      webClientUrl: null,
      scope: 'runtime',
      qr: null
    }
  }
}

describe('tunneledOrcadPairingCode', () => {
  it('rewrites only the endpoint authority for the local tunnel', () => {
    const rewritten = parsePairingCode(tunneledOrcadPairingCode(readiness(), 46_768))

    expect(rewritten).toEqual({
      v: PAIRING_OFFER_VERSION,
      endpoint: 'ws://127.0.0.1:46768/runtime?mode=paired#fragment',
      deviceToken: 'device-token',
      publicKeyB64: 'public-key',
      pairedDeviceId: 'device-1'
    })
  })

  it('rewrites a public advertised endpoint onto the SSH local forward', () => {
    const rewritten = parsePairingCode(
      tunneledOrcadPairingCode(readiness('wss://runtime.example.com/runtime'), 46_768)
    )
    expect(rewritten?.endpoint).toBe('ws://127.0.0.1:46768/runtime')
  })

  it('keeps the enrolled grant when startup pairing is unavailable', () => {
    const pairedOffer: PairingOffer = {
      v: PAIRING_OFFER_VERSION,
      endpoint: 'wss://runtime.example.com/runtime?mode=paired#fragment',
      deviceToken: 'enrolled-token',
      publicKeyB64: 'enrolled-key',
      pairedDeviceId: 'enrolled-device'
    }
    const unavailable: ServeReadiness = {
      ...readiness(),
      pairing: { available: false, reason: 'disabled_by_operator', guidance: 'Already enrolled' }
    }

    const rewritten = parsePairingCode(tunneledOrcadPairingCode(unavailable, 46_768, pairedOffer))

    expect(rewritten).toEqual({
      ...pairedOffer,
      endpoint: 'ws://127.0.0.1:46768/runtime?mode=paired#fragment'
    })
  })

  it('refuses a non-WebSocket offer', () => {
    expect(() =>
      tunneledOrcadPairingCode(readiness('https://runtime.example.com'), 46_768)
    ).toThrow('not a WebSocket URL')
  })
})
