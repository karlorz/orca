import { describe, expect, it, vi } from 'vitest'
import nacl from 'tweetnacl'
import { deriveRelayHostId } from './relay-http-client'
import { listenOwnMobileRelay } from './own-mobile-relay-http'
import { RelayControlClient } from './relay-control-client'
import { loginAndObtainSessionToken, TEST_OPERATOR } from './own-mobile-relay-test-auth'
import type { E2EEKeypair } from '../e2ee-keypair'

describe('own mobile relay host-control', () => {
  it('connects a real RelayControlClient and reaches active state with host-hello-ack', async () => {
    const hostKeys = nacl.box.keyPair()
    const keypair: E2EEKeypair = {
      publicKey: hostKeys.publicKey,
      secretKey: hostKeys.secretKey,
      publicKeyB64: Buffer.from(hostKeys.publicKey).toString('base64')
    }
    const relayHostId = deriveRelayHostId(hostKeys.publicKey)
    const identity = {
      userId: TEST_OPERATOR.userId,
      profileId: TEST_OPERATOR.profileId,
      organizationId: TEST_OPERATOR.organizationId
    }

    const server = await listenOwnMobileRelay({
      operator: TEST_OPERATOR,
      origin: 'http://127.0.0.1'
    })

    try {
      const sessionToken = await loginAndObtainSessionToken(server.origin)
      // Mint token
      const tokenRes = await fetch(`${server.origin}/v1/desktop/auth/relay-token`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${sessionToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          relayHostId,
          hostPublicKeyB64: keypair.publicKeyB64
        })
      })
      expect(tokenRes.status).toBe(200)
      const { relayToken } = (await tokenRes.json()) as { relayToken: string }

      // Assign
      const assignRes = await fetch(`${server.origin}/v1/assign`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${relayToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ v: 1, relayHostId })
      })
      expect(assignRes.status).toBe(200)
      const { cellUrl, assignmentEpoch } = (await assignRes.json()) as {
        cellUrl: string
        assignmentEpoch: number
      }

      const client = new RelayControlClient({
        cellUrl,
        relayJwt: relayToken,
        relayHostId,
        assignmentEpoch,
        identity,
        keypair,
        appVersion: '0.0.0-test',
        onConnectionOpen: vi.fn(),
        onDrain: vi.fn(),
        onClose: vi.fn()
      })

      const ack = await client.connect()
      expect(ack).toMatchObject({
        type: 'host-hello-ack',
        v: 1,
        generation: 1,
        activeConnIds: [],
        pendingConns: []
      })
      expect(ack.controlResumeSecret).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(client.isLive()).toBe(true)
      client.closeNow()
    } finally {
      await server.close()
    }
  })

  it('rejects connect() when Bearer token is wrong or unknown', async () => {
    const hostKeys = nacl.box.keyPair()
    const keypair: E2EEKeypair = {
      publicKey: hostKeys.publicKey,
      secretKey: hostKeys.secretKey,
      publicKeyB64: Buffer.from(hostKeys.publicKey).toString('base64')
    }
    const relayHostId = deriveRelayHostId(hostKeys.publicKey)
    const identity = {
      userId: TEST_OPERATOR.userId,
      profileId: TEST_OPERATOR.profileId,
      organizationId: TEST_OPERATOR.organizationId
    }

    const server = await listenOwnMobileRelay({
      operator: TEST_OPERATOR,
      origin: 'http://127.0.0.1'
    })

    try {
      const client = new RelayControlClient({
        cellUrl: server.origin,
        relayJwt: 'invalid-token-123',
        relayHostId,
        assignmentEpoch: 1,
        identity,
        keypair,
        appVersion: '0.0.0-test',
        onConnectionOpen: vi.fn(),
        onDrain: vi.fn(),
        onClose: vi.fn(),
        connectDeadlineMs: 500
      })

      await expect(client.connect()).rejects.toThrow()
      expect(client.isLive()).toBe(false)
    } finally {
      await server.close()
    }
  })

  it('answers client pings and terminates after silence watchdog limit', async () => {
    const hostKeys = nacl.box.keyPair()
    const keypair: E2EEKeypair = {
      publicKey: hostKeys.publicKey,
      secretKey: hostKeys.secretKey,
      publicKeyB64: Buffer.from(hostKeys.publicKey).toString('base64')
    }
    const relayHostId = deriveRelayHostId(hostKeys.publicKey)
    const identity = {
      userId: TEST_OPERATOR.userId,
      profileId: TEST_OPERATOR.profileId,
      organizationId: TEST_OPERATOR.organizationId
    }

    // Test with short silence limit (100ms) to test silence watchdog
    const server = await listenOwnMobileRelay({
      operator: TEST_OPERATOR,
      origin: 'http://127.0.0.1',
      silenceLimitMs: 100
    })

    try {
      const sessionToken = await loginAndObtainSessionToken(server.origin)
      const tokenRes = await fetch(`${server.origin}/v1/desktop/auth/relay-token`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${sessionToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          relayHostId,
          hostPublicKeyB64: keypair.publicKeyB64
        })
      })
      const { relayToken } = (await tokenRes.json()) as { relayToken: string }

      const onClose = vi.fn()
      const client = new RelayControlClient({
        cellUrl: server.origin,
        relayJwt: relayToken,
        relayHostId,
        assignmentEpoch: 1,
        identity,
        keypair,
        appVersion: '0.0.0-test',
        onConnectionOpen: vi.fn(),
        onDrain: vi.fn(),
        onClose
      })

      await client.connect()
      expect(client.isLive()).toBe(true)

      // Wait for silence watchdog to terminate socket
      await vi.waitFor(() => expect(onClose).toHaveBeenCalledWith(4401), { timeout: 1000 })
      expect(client.isLive()).toBe(false)
    } finally {
      await server.close()
    }
  })

  it('closes with 4401 on host-hello with mismatched relayHostId', async () => {
    const hostKeys = nacl.box.keyPair()
    const keypair: E2EEKeypair = {
      publicKey: hostKeys.publicKey,
      secretKey: hostKeys.secretKey,
      publicKeyB64: Buffer.from(hostKeys.publicKey).toString('base64')
    }
    const relayHostId = deriveRelayHostId(hostKeys.publicKey)
    const identity = {
      userId: TEST_OPERATOR.userId,
      profileId: TEST_OPERATOR.profileId,
      organizationId: TEST_OPERATOR.organizationId
    }

    const server = await listenOwnMobileRelay({
      operator: TEST_OPERATOR,
      origin: 'http://127.0.0.1'
    })

    try {
      const sessionToken = await loginAndObtainSessionToken(server.origin)
      const tokenRes = await fetch(`${server.origin}/v1/desktop/auth/relay-token`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${sessionToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          relayHostId,
          hostPublicKeyB64: keypair.publicKeyB64
        })
      })
      const { relayToken } = (await tokenRes.json()) as { relayToken: string }

      const onClose = vi.fn()
      const client = new RelayControlClient({
        cellUrl: server.origin,
        relayJwt: relayToken,
        relayHostId: 'mismatched-host-id',
        assignmentEpoch: 1,
        identity,
        keypair,
        appVersion: '0.0.0-test',
        onConnectionOpen: vi.fn(),
        onDrain: vi.fn(),
        onClose,
        connectDeadlineMs: 1000
      })

      await expect(client.connect()).rejects.toThrow()
      await vi.waitFor(() => expect(onClose).toHaveBeenCalledWith(4401))
    } finally {
      await server.close()
    }
  })
})
