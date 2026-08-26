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

  it('keeps RelayControlClient alive via ping/pong for >3x silenceLimitMs', async () => {
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

    const silenceLimitMs = 80
    const server = await listenOwnMobileRelay({
      operator: TEST_OPERATOR,
      origin: 'http://127.0.0.1',
      silenceLimitMs
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

      // Wait > 3x silenceLimitMs: client must stay isLive() because server pings and client pongs
      await new Promise((resolve) => setTimeout(resolve, silenceLimitMs * 3 + 50))
      expect(onClose).not.toHaveBeenCalled()
      expect(client.isLive()).toBe(true)

      client.closeNow()
    } finally {
      await server.close()
    }
  })

  it('keeps the active host registered when a pre-hello control socket closes early', async () => {
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

    const silenceLimitMs = 80
    const server = await listenOwnMobileRelay({
      operator: TEST_OPERATOR,
      origin: 'http://127.0.0.1',
      silenceLimitMs
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

      // Socket A: a real client that completes host-proof and activates.
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
        onClose: vi.fn()
      })
      await client.connect()
      expect(client.isLive()).toBe(true)

      // Socket B: valid grant but closes before host-hello (client abandoned it).
      const { WebSocket } = await import('ws')
      const wsBase = server.origin.replace('http', 'ws')
      const abandoned = new WebSocket(`${wsBase}/v1/host/control`, {
        headers: { authorization: `Bearer ${relayToken}` }
      })
      await new Promise<void>((resolve) => abandoned.once('open', () => resolve()))
      abandoned.close()

      // Well past the silence watchdog: the abandoned socket must not produce
      // a phantom close that removes socket A's active registration.
      await new Promise((resolve) => setTimeout(resolve, silenceLimitMs * 3 + 50))

      const probe = new WebSocket(`${wsBase}/v1/connect/${relayHostId}`)
      const probeCloseCode = await new Promise<number>((resolve, reject) => {
        probe.once('open', () => probe.send(JSON.stringify({ type: 'relay-auth', token: 'bogus' })))
        probe.once('close', (code) => resolve(code))
        probe.once('error', reject)
      })
      expect(probeCloseCode).toBe(4401)
      expect(client.isLive()).toBe(true)
      client.closeNow()
    } finally {
      await server.close()
    }
  })

  it('closes with 4401 on silence watchdog timeout when peer sends no frames', async () => {
    const hostKeys = nacl.box.keyPair()
    const keypair: E2EEKeypair = {
      publicKey: hostKeys.publicKey,
      secretKey: hostKeys.secretKey,
      publicKeyB64: Buffer.from(hostKeys.publicKey).toString('base64')
    }
    const relayHostId = deriveRelayHostId(hostKeys.publicKey)

    const silenceLimitMs = 80
    const server = await listenOwnMobileRelay({
      operator: TEST_OPERATOR,
      origin: 'http://127.0.0.1',
      silenceLimitMs
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

      // Connect raw WebSocket to /v1/host/control with valid Bearer and send no frames
      const wsUrl = `${server.origin.replace(/^http/, 'ws')}/v1/host/control`
      const { WebSocket } = await import('ws')
      const ws = new WebSocket(wsUrl, {
        headers: {
          authorization: `Bearer ${relayToken}`
        }
      })

      const closeEventPromise = new Promise<{ code: number; reason: string }>((resolve) => {
        ws.on('close', (code, reason) => {
          resolve({ code, reason: reason.toString() })
        })
      })

      const { code } = await closeEventPromise
      expect(code).toBe(4401)
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

  it('closes within one heartbeat interval after parent session logout', async () => {
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

    const silenceLimitMs = 60
    const server = await listenOwnMobileRelay({
      operator: TEST_OPERATOR,
      origin: 'http://127.0.0.1',
      silenceLimitMs
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

      // Log out parent session
      const logoutRes = await fetch(`${server.origin}/v1/desktop/auth/logout`, {
        method: 'POST',
        headers: { authorization: `Bearer ${sessionToken}` }
      })
      expect(logoutRes.status).toBe(200)

      // Within one heartbeat interval (silenceLimitMs / 3 = 20ms), control socket closes
      await vi.waitFor(() => expect(client.isLive()).toBe(false), { timeout: 500 })
      expect(onClose).toHaveBeenCalledWith(4401)
    } finally {
      await server.close()
    }
  })

  it('closes after account authorization epoch advances from password change/reset', async () => {
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

    const { createOwnMobileRelaySecurityStateMemory } =
      await import('./own-mobile-relay-security-state-memory')
    const securityState = createOwnMobileRelaySecurityStateMemory()

    const silenceLimitMs = 60
    const server = await listenOwnMobileRelay({
      operator: TEST_OPERATOR,
      securityState,
      origin: 'http://127.0.0.1',
      silenceLimitMs
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

      // Replace password verifier which bumps authEpoch
      const acc = await securityState.getAccountPasswordRecord()
      expect(acc).not.toBeNull()
      const replaceResult = await securityState.replacePasswordVerifier({
        expectedVerifierVersion: acc!.verifierVersion,
        newPasswordRecord: {
          version: 1,
          salt: '00'.repeat(16),
          verifier: '11'.repeat(32),
          params: {
            N: 1024,
            r: 8,
            p: 1,
            keyLen: 32,
            maxmem: 64 * 1024 * 1024
          }
        }
      })
      expect(replaceResult.ok).toBe(true)

      await vi.waitFor(() => expect(client.isLive()).toBe(false), { timeout: 500 })
      expect(onClose).toHaveBeenCalledWith(4401)
    } finally {
      await server.close()
    }
  })

  it('closes after grant expiry and after parent session expiry', async () => {
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

    const { createOwnMobileRelaySecurityStateMemory } =
      await import('./own-mobile-relay-security-state-memory')
    let fakeNow = Date.now()
    const baseState = createOwnMobileRelaySecurityStateMemory()
    const state: typeof baseState = {
      ...baseState,
      validateRelayGrantById: (grantId, hostId, now) =>
        baseState.validateRelayGrantById(grantId, hostId, now ?? fakeNow)
    }

    const silenceLimitMs = 60
    const server = await listenOwnMobileRelay({
      operator: TEST_OPERATOR,
      securityState: state,
      origin: 'http://127.0.0.1',
      silenceLimitMs
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

      // Advance time beyond grant TTL (e.g. + 2 days)
      fakeNow += 48 * 60 * 60 * 1000

      await vi.waitFor(() => expect(client.isLive()).toBe(false), { timeout: 500 })
      expect(onClose).toHaveBeenCalledWith(4401)
    } finally {
      await server.close()
    }
  })

  it('revalidation storage failure closes control rather than trusting previous grant', async () => {
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

    const { createOwnMobileRelaySecurityStateMemory } =
      await import('./own-mobile-relay-security-state-memory')
    const baseState = createOwnMobileRelaySecurityStateMemory()
    let throwOnRevalidate = false
    const state: typeof baseState = {
      ...baseState,
      validateRelayGrantById: async (grantId, hostId, now) => {
        if (throwOnRevalidate) {
          throw new Error('simulated_storage_failure')
        }
        return baseState.validateRelayGrantById(grantId, hostId, now)
      }
    }

    const silenceLimitMs = 60
    const server = await listenOwnMobileRelay({
      operator: TEST_OPERATOR,
      securityState: state,
      origin: 'http://127.0.0.1',
      silenceLimitMs
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

      // Trigger storage failure on revalidation
      throwOnRevalidate = true

      await vi.waitFor(() => expect(client.isLive()).toBe(false), { timeout: 500 })
      expect(onClose).toHaveBeenCalledWith(4401)
    } finally {
      await server.close()
    }
  })

  it('fails the control socket closed non-secretly if active control dispatch rejects unexpectedly', async () => {
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

    const { createOwnMobileRelaySecurityStateMemory } =
      await import('./own-mobile-relay-security-state-memory')
    const baseState = createOwnMobileRelaySecurityStateMemory()
    const state: typeof baseState = {
      ...baseState,
      revokeDeviceCredential: async () => {
        throw new Error('simulated_dispatch_rejection')
      }
    }

    const server = await listenOwnMobileRelay({
      operator: TEST_OPERATOR,
      securityState: state,
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

      // Send revoke device request which will trigger the throwing method
      await expect(client.revokeDevice('device-to-revoke-1')).rejects.toThrow()
      await vi.waitFor(() => expect(client.isLive()).toBe(false), { timeout: 500 })
      expect(onClose).toHaveBeenCalledWith(4401)
    } finally {
      await server.close()
    }
  })
})
