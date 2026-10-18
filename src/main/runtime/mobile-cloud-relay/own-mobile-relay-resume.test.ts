import { describe, expect, it, vi } from 'vitest'
import { createHash, randomBytes } from 'node:crypto'
import nacl from 'tweetnacl'
import WebSocket from 'ws'
import { deriveRelayHostId } from './relay-http-client'
import { listenOwnMobileRelay } from './own-mobile-relay-http'
import { RelayControlClient } from './relay-control-client'
import { loginAndObtainSessionToken, TEST_OPERATOR } from './own-mobile-relay-test-auth'
import type { E2EEKeypair } from '../e2ee-keypair'

function nextClose(socket: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    socket.once('close', (code, reason) => {
      resolve({ code, reason: reason.toString() })
    })
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

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
}

function sha256Base64Url(raw: string): string {
  return createHash('sha256').update(raw).digest('base64url')
}

function generateRawResumeToken(): string {
  return randomBytes(32).toString('base64url')
}

async function setupRelayClient(
  serverOrigin: string,
  callbacks?: {
    onConnectionOpen?: (msg: {
      type: 'conn-open'
      connId: string
      connTicket: string
      kind: 'invite' | 'resume'
      relayDeviceId: string
      attachDeadlineMs: number
    }) => void
  },
  customKeypair?: E2EEKeypair
) {
  const hostKeys = customKeypair ? null : nacl.box.keyPair()
  const keypair: E2EEKeypair = customKeypair ?? {
    publicKey: hostKeys!.publicKey,
    secretKey: hostKeys!.secretKey,
    publicKeyB64: Buffer.from(hostKeys!.publicKey).toString('base64')
  }
  const relayHostId = deriveRelayHostId(keypair.publicKey)
  const identity = {
    userId: TEST_OPERATOR.userId,
    profileId: TEST_OPERATOR.profileId,
    organizationId: TEST_OPERATOR.organizationId
  }

  const sessionToken = await loginAndObtainSessionToken(serverOrigin)
  const tokenRes = await fetch(`${serverOrigin}/v1/desktop/auth/relay-token`, {
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

  const assignRes = await fetch(`${serverOrigin}/v1/assign`, {
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
    onConnectionOpen: callbacks?.onConnectionOpen ?? vi.fn(),
    onDrain: vi.fn(),
    onClose: vi.fn()
  })

  await client.connect()
  return { client, relayHostId, keypair, identity, relayToken }
}

describe('own mobile relay resume + revoke', () => {
  it('1. install -> device-credential-installed (currentVersion 1, future resumeExpiresAt)', async () => {
    const server = await listenOwnMobileRelay({
      operator: TEST_OPERATOR,
      origin: 'http://127.0.0.1'
    })

    try {
      const { client } = await setupRelayClient(server.origin)
      const rawToken = generateRawResumeToken()
      const tokenHash = sha256Base64Url(rawToken)

      const now = Date.now()
      const installed = await client.installCredential({
        reqId: randomBytes(16).toString('hex'),
        relayDeviceId: 'device-1',
        newResumeTokenHash: tokenHash,
        authorization: { mode: 'relay-basis', basisConnId: 'conn-1' }
      })

      expect(installed).toMatchObject({
        v: 1,
        type: 'device-credential-installed',
        reqId: expect.any(String),
        authorizationMode: 'relay-basis',
        currentVersion: 1
      })
      expect(installed.resumeExpiresAt).toBeGreaterThan(now + 20 * 24 * 60 * 60 * 1000)
      expect(installed.graceExpiresAt).toBeUndefined()

      client.closeNow()
    } finally {
      await server.close()
    }
  })

  it('2. install-status -> committed with same hash; unknown device -> not-found', async () => {
    const server = await listenOwnMobileRelay({
      operator: TEST_OPERATOR,
      origin: 'http://127.0.0.1'
    })

    try {
      const { client } = await setupRelayClient(server.origin)
      const rawToken = generateRawResumeToken()
      const tokenHash = sha256Base64Url(rawToken)

      // Query unknown device
      const notFoundStatus = await client.credentialInstallStatus(
        'device-unknown',
        randomBytes(16).toString('hex')
      )
      expect(notFoundStatus).toMatchObject({
        v: 1,
        type: 'device-credential-install-status-result',
        state: 'not-found'
      })

      // Install credential
      const installRes = await client.installCredential({
        reqId: randomBytes(16).toString('hex'),
        relayDeviceId: 'device-1',
        newResumeTokenHash: tokenHash,
        authorization: { mode: 'relay-basis', basisConnId: 'conn-1' }
      })

      // Query committed device
      const committedStatus = await client.credentialInstallStatus(
        'device-1',
        randomBytes(16).toString('hex')
      )
      expect(committedStatus).toMatchObject({
        v: 1,
        type: 'device-credential-install-status-result',
        state: 'committed',
        result: {
          v: 1,
          reqId: installRes.reqId,
          authorizationMode: 'relay-basis',
          currentVersion: 1,
          resumeExpiresAt: installRes.resumeExpiresAt
        }
      })

      client.closeNow()
    } finally {
      await server.close()
    }
  })

  it('3. Resume auth on cell socket with raw token -> relay-hello ok credentialKind:resume + conn-open kind:resume; splice frame both ways', async () => {
    const server = await listenOwnMobileRelay({
      operator: TEST_OPERATOR,
      origin: 'http://127.0.0.1'
    })

    try {
      let connOpenMsg: { connId: string; connTicket: string; kind: string } | null = null
      const { client, relayHostId } = await setupRelayClient(server.origin, {
        onConnectionOpen: (msg) => {
          connOpenMsg = msg
        }
      })
      const rawToken = generateRawResumeToken()
      const tokenHash = sha256Base64Url(rawToken)

      await client.installCredential({
        reqId: randomBytes(16).toString('hex'),
        relayDeviceId: 'device-1',
        newResumeTokenHash: tokenHash,
        authorization: { mode: 'relay-basis', basisConnId: 'conn-1' }
      })

      // Connect phone with raw resume token
      const phoneWsUrl = `${server.origin.replace('http://', 'ws://')}/v1/connect/${relayHostId}`
      const phoneSocket = new WebSocket(phoneWsUrl)
      await waitForOpen(phoneSocket)

      const helloPromise = nextJson(phoneSocket)
      phoneSocket.send(
        JSON.stringify({
          type: 'relay-auth',
          v: 1,
          mode: 'connect',
          credential: rawToken
        })
      )

      const hello = await helloPromise
      expect(hello).toMatchObject({
        type: 'relay-hello',
        ok: true,
        credentialKind: 'resume',
        acceptedCredentialVersion: 1,
        acceptedAs: 'current',
        resumeExpiresAt: expect.any(Number)
      })
      expect((hello as { leaseExpiresAt?: number }).leaseExpiresAt).toBeGreaterThan(Date.now())
      expect((hello as { resumeExpiresAt?: number }).resumeExpiresAt).toBeGreaterThan(Date.now())

      await vi.waitFor(() => expect(connOpenMsg).not.toBeNull())
      expect(connOpenMsg).toMatchObject({
        type: 'conn-open',
        kind: 'resume',
        relayDeviceId: 'device-1'
      })

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

      // The phone sends pairing.getEndpoints only after E2EE authenticates,
      // which is necessarily after host-data attaches. The basis must remain
      // confirmable across that transition.
      const confirm = await client.confirmResume(connId, randomBytes(16).toString('hex'))
      expect(confirm).toMatchObject({
        v: 1,
        currentVersion: 1,
        acceptedAs: 'current',
        renewed: false
      })

      // Splicing: phone -> host text
      const hostReceivedText = nextFrame(hostDataSocket)
      phoneSocket.send('hello-resume-phone')
      const hostMsg = await hostReceivedText
      expect(hostMsg.isBinary).toBe(false)
      expect(hostMsg.data).toBe('hello-resume-phone')

      // Splicing: host -> phone binary
      const phoneReceivedBinary = nextFrame(phoneSocket)
      const testBuffer = Buffer.from([10, 20, 30])
      hostDataSocket.send(testBuffer)
      const phoneMsg = await phoneReceivedBinary
      expect(phoneMsg.isBinary).toBe(true)
      expect(Buffer.from(phoneMsg.data as Buffer)).toEqual(testBuffer)

      hostDataSocket.close()
      phoneSocket.close()
      client.closeNow()
    } finally {
      await server.close()
    }
  })

  it('4. Re-install with expectedCurrentHash -> rotation: old token still resumes (grace); device-resume-confirm on that conn -> acceptedAs:grace', async () => {
    const server = await listenOwnMobileRelay({
      operator: TEST_OPERATOR,
      origin: 'http://127.0.0.1'
    })

    try {
      let connOpenMsg: { connId: string; connTicket: string; kind: string } | null = null
      const { client, relayHostId } = await setupRelayClient(server.origin, {
        onConnectionOpen: (msg) => {
          connOpenMsg = msg
        }
      })
      const rawToken1 = generateRawResumeToken()
      const tokenHash1 = sha256Base64Url(rawToken1)

      const rawToken2 = generateRawResumeToken()
      const tokenHash2 = sha256Base64Url(rawToken2)

      // First install
      const install1 = await client.installCredential({
        reqId: randomBytes(16).toString('hex'),
        relayDeviceId: 'device-1',
        newResumeTokenHash: tokenHash1,
        authorization: { mode: 'relay-basis', basisConnId: 'conn-1' }
      })
      expect(install1.currentVersion).toBe(1)

      // Rotate with expectedCurrentHash
      const install2 = await client.installCredential({
        reqId: randomBytes(16).toString('hex'),
        relayDeviceId: 'device-1',
        newResumeTokenHash: tokenHash2,
        expectedCurrentHash: tokenHash1,
        authorization: { mode: 'relay-basis', basisConnId: 'conn-1' }
      })
      expect(install2.currentVersion).toBe(2)
      expect(install2.graceExpiresAt).toBeGreaterThan(Date.now())

      // Connect phone with old token (rawToken1) -> resumes on grace
      const phoneWsUrl = `${server.origin.replace('http://', 'ws://')}/v1/connect/${relayHostId}`
      const phoneSocket = new WebSocket(phoneWsUrl)
      await waitForOpen(phoneSocket)

      const helloPromise = nextJson(phoneSocket)
      phoneSocket.send(
        JSON.stringify({
          type: 'relay-auth',
          v: 1,
          mode: 'connect',
          credential: rawToken1
        })
      )

      const hello = await helloPromise
      expect(hello).toMatchObject({
        type: 'relay-hello',
        ok: true,
        credentialKind: 'resume'
      })

      await vi.waitFor(() => expect(connOpenMsg).not.toBeNull())
      const { connId } = connOpenMsg!

      // Confirm resume for basis connId
      const confirmRes = await client.confirmResume(connId, randomBytes(16).toString('hex'))
      expect(confirmRes).toMatchObject({
        v: 1,
        type: 'device-resume-confirmed',
        currentVersion: 2,
        acceptedAs: 'grace',
        renewed: false
      })

      phoneSocket.close()
      client.closeNow()
    } finally {
      await server.close()
    }
  })

  it('5. POST /v1/resolve valid -> cellUrl; unknown token -> 401', async () => {
    const server = await listenOwnMobileRelay({
      operator: TEST_OPERATOR,
      origin: 'http://127.0.0.1'
    })

    try {
      const { client, relayHostId } = await setupRelayClient(server.origin)
      const rawToken = generateRawResumeToken()
      const tokenHash = sha256Base64Url(rawToken)

      await client.installCredential({
        reqId: randomBytes(16).toString('hex'),
        relayDeviceId: 'device-1',
        newResumeTokenHash: tokenHash,
        authorization: { mode: 'relay-basis', basisConnId: 'conn-1' }
      })

      // Valid token resolve
      const validRes = await fetch(`${server.origin}/v1/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          v: 1,
          relayHostId,
          resumeToken: rawToken
        })
      })
      expect(validRes.status).toBe(200)
      const validData = (await validRes.json()) as {
        v: number
        cellUrl: string
        assignmentEpoch: number
        leaseExpiresAt: number
      }
      expect(validData).toMatchObject({
        v: 1,
        cellUrl: server.origin,
        assignmentEpoch: 1
      })
      expect(validData.leaseExpiresAt).toBeGreaterThan(Date.now())

      // Unknown token resolve -> 401
      const invalidRes = await fetch(`${server.origin}/v1/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          v: 1,
          relayHostId,
          resumeToken: generateRawResumeToken()
        })
      })
      expect(invalidRes.status).toBe(401)

      client.closeNow()
    } finally {
      await server.close()
    }
  })

  it('6. revoke -> device-revoked; then resume -> 4401 and resolve -> 401', async () => {
    const server = await listenOwnMobileRelay({
      operator: TEST_OPERATOR,
      origin: 'http://127.0.0.1'
    })

    try {
      const { client, relayHostId } = await setupRelayClient(server.origin)
      const rawToken = generateRawResumeToken()
      const tokenHash = sha256Base64Url(rawToken)

      await client.installCredential({
        reqId: randomBytes(16).toString('hex'),
        relayDeviceId: 'device-1',
        newResumeTokenHash: tokenHash,
        authorization: { mode: 'relay-basis', basisConnId: 'conn-1' }
      })

      // Revoke device
      await client.revokeDevice('device-1', randomBytes(16).toString('hex'))

      // Resume on cell socket should fail with 4401
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
          credential: rawToken
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

      // Resolve via HTTP should fail with 401
      const resolveRes = await fetch(`${server.origin}/v1/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          v: 1,
          relayHostId,
          resumeToken: rawToken
        })
      })
      expect(resolveRes.status).toBe(401)

      client.closeNow()
    } finally {
      await server.close()
    }
  })

  it('7. install with wrong expectedCurrentHash -> control-error code:hash-mismatch, stored hashes unchanged', async () => {
    const server = await listenOwnMobileRelay({
      operator: TEST_OPERATOR,
      origin: 'http://127.0.0.1'
    })

    try {
      const { client } = await setupRelayClient(server.origin)
      const rawToken1 = generateRawResumeToken()
      const tokenHash1 = sha256Base64Url(rawToken1)

      const rawToken2 = generateRawResumeToken()
      const tokenHash2 = sha256Base64Url(rawToken2)

      // Initial install
      await client.installCredential({
        reqId: randomBytes(16).toString('hex'),
        relayDeviceId: 'device-1',
        newResumeTokenHash: tokenHash1,
        authorization: { mode: 'relay-basis', basisConnId: 'conn-1' }
      })

      // Install with wrong expectedCurrentHash
      const wrongExpectedHash = sha256Base64Url('wrong-token-hash-value-12345678901234567')
      await expect(
        client.installCredential({
          reqId: randomBytes(16).toString('hex'),
          relayDeviceId: 'device-1',
          newResumeTokenHash: tokenHash2,
          expectedCurrentHash: wrongExpectedHash,
          authorization: { mode: 'relay-basis', basisConnId: 'conn-1' }
        })
      ).rejects.toThrow('hash-mismatch')

      // Verify stored hashes unchanged (status still version 1 with original install)
      const status = await client.credentialInstallStatus(
        'device-1',
        randomBytes(16).toString('hex')
      )
      expect(status).toMatchObject({
        v: 1,
        type: 'device-credential-install-status-result',
        state: 'committed',
        result: {
          v: 1,
          currentVersion: 1
        }
      })

      client.closeNow()
    } finally {
      await server.close()
    }
  })
})
