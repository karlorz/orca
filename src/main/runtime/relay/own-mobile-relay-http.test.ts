import { describe, expect, it } from 'vitest'
import nacl from 'tweetnacl'
import { deriveRelayHostId } from './relay-http-client'
import { listenOwnMobileRelay } from './own-mobile-relay-http'

describe('own mobile relay HTTP', () => {
  it('serves GET /health', async () => {
    const server = await listenOwnMobileRelay({
      operatorAccessToken: 'lab-access',
      origin: 'http://127.0.0.1'
    })
    try {
      const response = await fetch(`${server.origin}/health`)
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ ok: true })
    } finally {
      await server.close()
    }
  })

  it('mints a relay token and assigns the listen origin as the cell', async () => {
    const hostPublicKey = nacl.box.keyPair().publicKey
    const hostPublicKeyB64 = Buffer.from(hostPublicKey).toString('base64')
    const relayHostId = deriveRelayHostId(hostPublicKey)
    const server = await listenOwnMobileRelay({
      operatorAccessToken: 'lab-access',
      origin: 'http://127.0.0.1'
    })
    try {
      const unauthorized = await fetch(`${server.origin}/v1/desktop/auth/relay-token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ relayHostId, hostPublicKeyB64 })
      })
      expect(unauthorized.status).toBe(401)

      const tokenResponse = await fetch(`${server.origin}/v1/desktop/auth/relay-token`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer lab-access',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ relayHostId, hostPublicKeyB64 })
      })
      expect(tokenResponse.status).toBe(200)
      const tokenBody = (await tokenResponse.json()) as { relayToken: string; expiresAt: number }
      expect(tokenBody.relayToken.length).toBeGreaterThan(8)
      expect(tokenBody.expiresAt).toBeGreaterThan(Date.now())

      const assignResponse = await fetch(`${server.origin}/v1/assign`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${tokenBody.relayToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ v: 1, relayHostId })
      })
      expect(assignResponse.status).toBe(200)
      await expect(assignResponse.json()).resolves.toEqual({
        v: 1,
        cellUrl: server.origin,
        assignmentEpoch: 1,
        lease: expect.any(String)
      })
    } finally {
      await server.close()
    }
  })
})
