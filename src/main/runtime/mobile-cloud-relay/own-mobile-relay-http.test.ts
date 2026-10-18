import { describe, expect, it } from 'vitest'
import nacl from 'tweetnacl'
import { deriveRelayHostId } from './relay-http-client'
import { listenOwnMobileRelay } from './own-mobile-relay-http'
import { RelayControlClient } from './relay-control-client'
import { loginAndObtainSessionToken, TEST_OPERATOR } from './own-mobile-relay-test-auth'

describe('own mobile relay HTTP', () => {
  it('serves GET /health', async () => {
    const server = await listenOwnMobileRelay({
      operator: TEST_OPERATOR,
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
      operator: TEST_OPERATOR,
      origin: 'http://127.0.0.1'
    })
    try {
      const sessionToken = await loginAndObtainSessionToken(server.origin)

      const unauthorized = await fetch(`${server.origin}/v1/desktop/auth/relay-token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ relayHostId, hostPublicKeyB64 })
      })
      expect(unauthorized.status).toBe(401)

      const tokenResponse = await fetch(`${server.origin}/v1/desktop/auth/relay-token`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${sessionToken}`,
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

  it('listens on an explicit host and port when specified in options', async () => {
    const server = await listenOwnMobileRelay({
      operator: TEST_OPERATOR,
      origin: 'http://127.0.0.1:0',
      listenHost: '127.0.0.1',
      listenPort: 18991
    })
    try {
      expect(server.origin).toBe('http://127.0.0.1:18991')
      const response = await fetch('http://127.0.0.1:18991/health')
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ ok: true })
    } finally {
      await server.close()
    }
  })

  it('advertises verbatim origin without port and passes it to assign and host challenge', async () => {
    const hostKeys = nacl.box.keyPair()
    const hostPublicKeyB64 = Buffer.from(hostKeys.publicKey).toString('base64')
    const relayHostId = deriveRelayHostId(hostKeys.publicKey)

    const server = await listenOwnMobileRelay({
      operator: TEST_OPERATOR,
      origin: 'https://orca-relay.karldigi.dev'
    })
    try {
      expect(server.origin).toBe('https://orca-relay.karldigi.dev')
      const boundPort = server.boundPort
      expect(typeof boundPort).toBe('number')
      expect(boundPort).toBeGreaterThan(0)

      // Direct local fetch on bound port using http
      const sessionToken = await loginAndObtainSessionToken(`http://127.0.0.1:${boundPort}`)

      const tokenResponse = await fetch(
        `http://127.0.0.1:${boundPort}/v1/desktop/auth/relay-token`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${sessionToken}`,
            'content-type': 'application/json'
          },
          body: JSON.stringify({ relayHostId, hostPublicKeyB64 })
        }
      )
      expect(tokenResponse.status).toBe(200)
      const { relayToken } = (await tokenResponse.json()) as { relayToken: string }

      const assignResponse = await fetch(`http://127.0.0.1:${boundPort}/v1/assign`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${relayToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ v: 1, relayHostId })
      })
      expect(assignResponse.status).toBe(200)
      const assignBody = (await assignResponse.json()) as {
        cellUrl: string
        assignmentEpoch: number
      }
      expect(assignBody.cellUrl).toBe('https://orca-relay.karldigi.dev')

      // Also verify RelayControlClient connects using the verbatim cellUrl when connecting through local port
      // We can use RelayControlClient with local port URL or mock/verify host challenge uses verbatim advertised origin
      const client = new RelayControlClient({
        cellUrl: `http://127.0.0.1:${boundPort}`,
        relayJwt: relayToken,
        relayHostId,
        assignmentEpoch: assignBody.assignmentEpoch,
        identity: {
          userId: TEST_OPERATOR.userId,
          profileId: TEST_OPERATOR.profileId,
          organizationId: TEST_OPERATOR.organizationId
        },
        keypair: {
          publicKey: hostKeys.publicKey,
          secretKey: hostKeys.secretKey,
          publicKeyB64: hostPublicKeyB64
        },
        appVersion: '0.0.0-test',
        onConnectionOpen: () => {},
        onDrain: () => {},
        onClose: () => {}
      })
      // RelayControlClient will use this.relayOrigin = endpoint.origin (`http://127.0.0.1:${boundPort}`)
      // but server challengeInput uses options.advertisedOrigin ('https://orca-relay.karldigi.dev')
      // If RelayControlClient verifies proof with mismatched origin, it will fail, which proves server used advertisedOrigin
      // Let's verify by connecting:
      const connectPromise = client.connect()
      // RelayControlClient expects server challenge relayOrigin to match client's relayOrigin (http://127.0.0.1:port)
      // Because server used verbatim advertised origin ('https://orca-relay.karldigi.dev'), client will reject challenge proof
      await expect(connectPromise).rejects.toThrow(/invalid host challenge.*origin=/)
      client.closeNow()
    } finally {
      await server.close()
    }
  })
})
