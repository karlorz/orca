import { describe, expect, it, vi } from 'vitest'
import nacl from 'tweetnacl'
import WebSocket from 'ws'
import { deriveRelayHostId } from './relay-http-client'
import { listenOwnMobileRelay } from './own-mobile-relay-http'
import { RelayControlClient } from './relay-control-client'
import { loginAndObtainSessionToken, TEST_OPERATOR } from './own-mobile-relay-test-auth'
import type { E2EEKeypair } from '../e2ee-keypair'

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
}

function nextJson(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    socket.once('message', (raw) => resolve(JSON.parse(raw.toString())))
  })
}

function nextFrame(socket: WebSocket): Promise<{ data: Buffer | string; isBinary: boolean }> {
  return new Promise((resolve) => {
    socket.once('message', (raw, isBinary) => {
      resolve({
        data: isBinary ? (raw as Buffer) : raw.toString(),
        isBinary
      })
    })
  })
}

function nextClose(socket: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    socket.once('close', (code, reason) => {
      resolve({ code, reason: reason.toString() })
    })
  })
}

describe('own mobile relay invite & splice', () => {
  it('createInvite resolves with 43-char token, expiresAt <= now+10 min, maxAttempts 8', async () => {
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

      const assignRes = await fetch(`${server.origin}/v1/assign`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${relayToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ v: 1, relayHostId })
      })
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

      await client.connect()

      const now = Date.now()
      const invite = await client.createInvite('device-1')
      expect(invite.inviteToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(invite.expiresAt).toBeGreaterThan(now)
      expect(invite.expiresAt).toBeLessThanOrEqual(Date.now() + 10 * 60 * 1000)
      expect(invite.maxAttempts).toBe(8)

      client.closeNow()
    } finally {
      await server.close()
    }
  })

  it('phone relay-auth with invite token -> relay-hello ok:true and desktop onConnectionOpen fires', async () => {
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

      const assignRes = await fetch(`${server.origin}/v1/assign`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${relayToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ v: 1, relayHostId })
      })
      const { cellUrl, assignmentEpoch } = (await assignRes.json()) as {
        cellUrl: string
        assignmentEpoch: number
      }

      const onConnectionOpen = vi.fn()
      const client = new RelayControlClient({
        cellUrl,
        relayJwt: relayToken,
        relayHostId,
        assignmentEpoch,
        identity,
        keypair,
        appVersion: '0.0.0-test',
        onConnectionOpen,
        onDrain: vi.fn(),
        onClose: vi.fn()
      })

      await client.connect()
      const invite = await client.createInvite('device-1')

      const phoneWsUrl = `${server.origin.replace('http://', 'ws://')}/v1/connect/${relayHostId}`
      const phoneSocket = new WebSocket(phoneWsUrl)
      await waitForOpen(phoneSocket)

      const helloPromise = nextJson(phoneSocket)
      phoneSocket.send(
        JSON.stringify({
          type: 'relay-auth',
          v: 1,
          mode: 'connect',
          credential: invite.inviteToken
        })
      )

      const hello = await helloPromise
      expect(hello).toMatchObject({
        type: 'relay-hello',
        ok: true,
        credentialKind: 'invite'
      })
      expect((hello as { leaseExpiresAt?: number }).leaseExpiresAt).toBeGreaterThan(Date.now())

      await vi.waitFor(() => {
        expect(onConnectionOpen).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'conn-open',
            kind: 'invite',
            relayDeviceId: 'device-1',
            attachDeadlineMs: 5000
          })
        )
      })

      phoneSocket.close()
      client.closeNow()
    } finally {
      await server.close()
    }
  })

  it('full splice: host attaches /v1/host/data/{connId}, text phone->host arrives verbatim, binary host->phone arrives verbatim', async () => {
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

      const assignRes = await fetch(`${server.origin}/v1/assign`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${relayToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ v: 1, relayHostId })
      })
      const { cellUrl, assignmentEpoch } = (await assignRes.json()) as {
        cellUrl: string
        assignmentEpoch: number
      }

      let connOpenMsg: { connId: string; connTicket: string } | null = null
      const client = new RelayControlClient({
        cellUrl,
        relayJwt: relayToken,
        relayHostId,
        assignmentEpoch,
        identity,
        keypair,
        appVersion: '0.0.0-test',
        onConnectionOpen: (msg) => {
          connOpenMsg = msg
        },
        onDrain: vi.fn(),
        onClose: vi.fn()
      })

      await client.connect()
      const invite = await client.createInvite('device-1')

      const phoneWsUrl = `${server.origin.replace('http://', 'ws://')}/v1/connect/${relayHostId}`
      const phoneSocket = new WebSocket(phoneWsUrl)
      await waitForOpen(phoneSocket)

      const helloPromise = nextJson(phoneSocket)
      phoneSocket.send(
        JSON.stringify({
          type: 'relay-auth',
          v: 1,
          mode: 'connect',
          credential: invite.inviteToken
        })
      )
      await helloPromise

      await vi.waitFor(() => expect(connOpenMsg).not.toBeNull())
      const { connId, connTicket } = connOpenMsg!

      // Host attaches to /v1/host/data/{connId}
      const hostDataWsUrl = `${server.origin.replace('http://', 'ws://')}/v1/host/data/${connId}`
      const hostDataSocket = new WebSocket(hostDataWsUrl)
      await waitForOpen(hostDataSocket)

      hostDataSocket.send(
        JSON.stringify({
          type: 'host-data-auth',
          v: 1,
          connTicket,
          generation: 1
        })
      )

      // Test text frame phone -> host
      const hostReceivedText = nextFrame(hostDataSocket)
      phoneSocket.send('hello-from-phone-text')
      const hostMsg = await hostReceivedText
      expect(hostMsg.isBinary).toBe(false)
      expect(hostMsg.data).toBe('hello-from-phone-text')

      // Test binary frame host -> phone
      const phoneReceivedBinary = nextFrame(phoneSocket)
      const testBuffer = Buffer.from([1, 2, 3, 4, 5])
      hostDataSocket.send(testBuffer)
      const phoneMsg = await phoneReceivedBinary
      expect(phoneMsg.isBinary).toBe(true)
      expect(Buffer.from(phoneMsg.data as Buffer)).toEqual(testBuffer)

      // Test close propagation (closing hostDataSocket closes phone with 4408)
      const phoneClosePromise = nextClose(phoneSocket)
      hostDataSocket.close()
      const phoneClose = await phoneClosePromise
      expect(phoneClose.code).toBe(4408)

      client.closeNow()
    } finally {
      await server.close()
    }
  })

  it('phone sends text and binary frames immediately after relay-hello before host attaches -> host receives buffered frames verbatim', async () => {
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

      const assignRes = await fetch(`${server.origin}/v1/assign`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${relayToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ v: 1, relayHostId })
      })
      const { cellUrl, assignmentEpoch } = (await assignRes.json()) as {
        cellUrl: string
        assignmentEpoch: number
      }

      let connOpenMsg: { connId: string; connTicket: string } | null = null
      const client = new RelayControlClient({
        cellUrl,
        relayJwt: relayToken,
        relayHostId,
        assignmentEpoch,
        identity,
        keypair,
        appVersion: '0.0.0-test',
        onConnectionOpen: (msg) => {
          connOpenMsg = msg
        },
        onDrain: vi.fn(),
        onClose: vi.fn()
      })

      await client.connect()
      const invite = await client.createInvite('device-1')

      const phoneWsUrl = `${server.origin.replace('http://', 'ws://')}/v1/connect/${relayHostId}`
      const phoneSocket = new WebSocket(phoneWsUrl)
      await waitForOpen(phoneSocket)

      const helloPromise = nextJson(phoneSocket)
      phoneSocket.send(
        JSON.stringify({
          type: 'relay-auth',
          v: 1,
          mode: 'connect',
          credential: invite.inviteToken
        })
      )
      const hello = await helloPromise
      expect(hello).toMatchObject({
        type: 'relay-hello',
        ok: true,
        credentialKind: 'invite'
      })

      // Send early text and binary frames BEFORE host attaches
      phoneSocket.send('early-phone-text-frame')
      const earlyBinary = Buffer.from([100, 101, 102, 103])
      phoneSocket.send(earlyBinary)

      await vi.waitFor(() => expect(connOpenMsg).not.toBeNull())
      const { connId, connTicket } = connOpenMsg!

      // Host attaches to /v1/host/data/{connId}
      const hostDataWsUrl = `${server.origin.replace('http://', 'ws://')}/v1/host/data/${connId}`
      const hostDataSocket = new WebSocket(hostDataWsUrl)
      await waitForOpen(hostDataSocket)

      const hostReceivedFrames = new Promise<{ data: Buffer | string; isBinary: boolean }[]>(
        (resolve) => {
          const frames: { data: Buffer | string; isBinary: boolean }[] = []
          const onMessage = (raw: WebSocket.RawData, isBinary: boolean) => {
            frames.push({
              data: isBinary ? (raw as Buffer) : raw.toString(),
              isBinary
            })
            if (frames.length === 2) {
              hostDataSocket.off('message', onMessage)
              resolve(frames)
            }
          }
          hostDataSocket.on('message', onMessage)
        }
      )

      hostDataSocket.send(
        JSON.stringify({
          type: 'host-data-auth',
          v: 1,
          connTicket,
          generation: 1
        })
      )

      const frames = await hostReceivedFrames
      expect(frames[0].isBinary).toBe(false)
      expect(frames[0].data).toBe('early-phone-text-frame')

      expect(frames[1].isBinary).toBe(true)
      expect(Buffer.from(frames[1].data as Buffer)).toEqual(earlyBinary)

      phoneSocket.close()
      hostDataSocket.close()
      client.closeNow()
    } finally {
      await server.close()
    }
  })

  it('phone exceeds buffer frame limit before host attach -> phone closed 4401', async () => {
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

      const assignRes = await fetch(`${server.origin}/v1/assign`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${relayToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ v: 1, relayHostId })
      })
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

      await client.connect()
      const invite = await client.createInvite('device-1')

      const phoneWsUrl = `${server.origin.replace('http://', 'ws://')}/v1/connect/${relayHostId}`
      const phoneSocket = new WebSocket(phoneWsUrl)
      await waitForOpen(phoneSocket)

      const helloPromise = nextJson(phoneSocket)
      const closePromise = nextClose(phoneSocket)

      phoneSocket.send(
        JSON.stringify({
          type: 'relay-auth',
          v: 1,
          mode: 'connect',
          credential: invite.inviteToken
        })
      )
      const hello = await helloPromise
      expect(hello).toMatchObject({
        type: 'relay-hello',
        ok: true
      })

      // Send 17 frames (MAX_BUFFERED_FRAMES is 16)
      for (let i = 0; i < 17; i++) {
        phoneSocket.send(`frame-${i}`)
      }

      const close = await closePromise
      expect(close.code).toBe(4401)

      client.closeNow()
    } finally {
      await server.close()
    }
  })

  it('bad invite token -> relay-hello ok:false code:4401 then close 4401', async () => {
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

      const assignRes = await fetch(`${server.origin}/v1/assign`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${relayToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ v: 1, relayHostId })
      })
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

      await client.connect()

      const phoneWsUrl = `${server.origin.replace('http://', 'ws://')}/v1/connect/${relayHostId}`
      const phoneSocket = new WebSocket(phoneWsUrl)
      await waitForOpen(phoneSocket)

      const helloPromise = nextJson(phoneSocket)
      const closePromise = nextClose(phoneSocket)

      phoneSocket.send(
        JSON.stringify({
          type: 'relay-auth',
          v: 1,
          mode: 'connect',
          credential: 'invalid-invite-token-value-1234567890123456'
        })
      )

      const hello = await helloPromise
      expect(hello).toMatchObject({
        type: 'relay-hello',
        ok: false,
        code: 4401
      })

      const close = await closePromise
      expect(close.code).toBe(4401)

      client.closeNow()
    } finally {
      await server.close()
    }
  })

  it('phone auth while no host control is connected -> close 4404', async () => {
    const server = await listenOwnMobileRelay({
      operator: TEST_OPERATOR,
      origin: 'http://127.0.0.1'
    })

    try {
      const phoneWsUrl = `${server.origin.replace('http://', 'ws://')}/v1/connect/non-existent-host-id`
      const phoneSocket = new WebSocket(phoneWsUrl)
      await waitForOpen(phoneSocket)

      const closePromise = nextClose(phoneSocket)
      const close = await closePromise
      expect(close.code).toBe(4404)
    } finally {
      await server.close()
    }
  })

  it('wrong connTicket on host-data -> close 4401', async () => {
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

      const assignRes = await fetch(`${server.origin}/v1/assign`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${relayToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ v: 1, relayHostId })
      })
      const { cellUrl, assignmentEpoch } = (await assignRes.json()) as {
        cellUrl: string
        assignmentEpoch: number
      }

      let connOpenMsg: { connId: string; connTicket: string } | null = null
      const client = new RelayControlClient({
        cellUrl,
        relayJwt: relayToken,
        relayHostId,
        assignmentEpoch,
        identity,
        keypair,
        appVersion: '0.0.0-test',
        onConnectionOpen: (msg) => {
          connOpenMsg = msg
        },
        onDrain: vi.fn(),
        onClose: vi.fn()
      })

      await client.connect()
      const invite = await client.createInvite('device-1')

      const phoneWsUrl = `${server.origin.replace('http://', 'ws://')}/v1/connect/${relayHostId}`
      const phoneSocket = new WebSocket(phoneWsUrl)
      await waitForOpen(phoneSocket)

      const helloPromise = nextJson(phoneSocket)
      phoneSocket.send(
        JSON.stringify({
          type: 'relay-auth',
          v: 1,
          mode: 'connect',
          credential: invite.inviteToken
        })
      )
      await helloPromise

      await vi.waitFor(() => expect(connOpenMsg).not.toBeNull())
      const { connId } = connOpenMsg!

      // Host attaches to /v1/host/data/{connId} with wrong ticket
      const hostDataWsUrl = `${server.origin.replace('http://', 'ws://')}/v1/host/data/${connId}`
      const hostDataSocket = new WebSocket(hostDataWsUrl)
      await waitForOpen(hostDataSocket)

      const closePromise = nextClose(hostDataSocket)

      hostDataSocket.send(
        JSON.stringify({
          type: 'host-data-auth',
          v: 1,
          connTicket: 'wrong-ticket-value-12345678901234567890123',
          generation: 1
        })
      )

      const close = await closePromise
      expect(close.code).toBe(4401)

      phoneSocket.close()
      client.closeNow()
    } finally {
      await server.close()
    }
  })
})
