import { describe, expect, it, vi } from 'vitest'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import nacl from 'tweetnacl'
import WebSocket from 'ws'
import { deriveRelayHostId } from './relay-http-client'
import { listenOwnMobileRelay } from './own-mobile-relay-http'
import { RelayControlClient } from './relay-control-client'
import { loginAndObtainSessionToken, TEST_OPERATOR } from './own-mobile-relay-test-auth'
import type { E2EEKeypair } from '../e2ee-keypair'
import { openOwnMobileRelaySecurityStateSqlite } from './own-mobile-relay-security-state-sqlite'
import { RelayPhoneHelloSchema } from '../../../shared/mobile-relay-phone-protocol'

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

describe('own mobile relay durable device security integration', () => {
  it('Case 1: Device install persists and status remains committed after server close/reopen', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-task5-c1-'))
    const dbPath = join(dir, 'relay-security.db')

    try {
      const securityState1 = openOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: true })
      const server1 = await listenOwnMobileRelay({
        operator: TEST_OPERATOR,
        securityState: securityState1,
        origin: 'http://127.0.0.1'
      })

      const rawToken = generateRawResumeToken()
      const tokenHash = sha256Base64Url(rawToken)

      const { client: client1, relayHostId, keypair } = await setupRelayClient(server1.origin)
      const installed = await client1.installCredential({
        reqId: 'req-install-c1',
        relayDeviceId: 'device-persisted-1',
        newResumeTokenHash: tokenHash,
        authorization: { mode: 'relay-basis', basisConnId: 'conn-1' }
      })
      expect(installed.currentVersion).toBe(1)
      client1.closeNow()
      await server1.close()

      const securityState2 = openOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: true })
      const server2 = await listenOwnMobileRelay({
        operator: TEST_OPERATOR,
        securityState: securityState2,
        origin: 'http://127.0.0.1'
      })

      const { client: client2 } = await setupRelayClient(server2.origin, undefined, keypair)
      const status = await client2.credentialInstallStatus('device-persisted-1', 'req-status-c1')
      expect(status).toMatchObject({
        v: 1,
        type: 'device-credential-install-status-result',
        state: 'committed',
        result: {
          v: 1,
          reqId: 'req-install-c1',
          authorizationMode: 'relay-basis',
          currentVersion: 1,
          resumeExpiresAt: installed.resumeExpiresAt
        }
      })

      const phoneWsUrl = `${server2.origin.replace('http://', 'ws://')}/v1/connect/${relayHostId}`
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
        acceptedAs: 'current'
      })

      phoneSocket.close()
      client2.closeNow()
      await server2.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('Case 2: Expected-current mismatch changes nothing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-task5-c2-'))
    const dbPath = join(dir, 'relay-security.db')

    try {
      const securityState1 = openOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: true })
      const server1 = await listenOwnMobileRelay({
        operator: TEST_OPERATOR,
        securityState: securityState1,
        origin: 'http://127.0.0.1'
      })

      const rawToken1 = generateRawResumeToken()
      const tokenHash1 = sha256Base64Url(rawToken1)

      const { client: client1, relayHostId, keypair } = await setupRelayClient(server1.origin)
      await client1.installCredential({
        reqId: 'req-install-c2-v1',
        relayDeviceId: 'device-cas-1',
        newResumeTokenHash: tokenHash1,
        authorization: { mode: 'relay-basis', basisConnId: 'conn-1' }
      })

      const wrongHash = sha256Base64Url(generateRawResumeToken())
      const newHash = sha256Base64Url(generateRawResumeToken())

      await expect(
        client1.installCredential({
          reqId: 'req-install-c2-fail',
          relayDeviceId: 'device-cas-1',
          newResumeTokenHash: newHash,
          expectedCurrentHash: wrongHash,
          authorization: { mode: 'relay-basis', basisConnId: 'conn-1' }
        })
      ).rejects.toThrow('hash-mismatch')

      client1.closeNow()
      await server1.close()

      const securityState2 = openOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: true })
      const server2 = await listenOwnMobileRelay({
        operator: TEST_OPERATOR,
        securityState: securityState2,
        origin: 'http://127.0.0.1'
      })

      const { client: client2 } = await setupRelayClient(server2.origin, undefined, keypair)
      const status = await client2.credentialInstallStatus('device-cas-1', 'req-status-c2')
      expect(status).toMatchObject({
        v: 1,
        type: 'device-credential-install-status-result',
        state: 'committed',
        result: {
          v: 1,
          reqId: 'req-install-c2-v1',
          currentVersion: 1
        }
      })

      const phoneWsUrl = `${server2.origin.replace('http://', 'ws://')}/v1/connect/${relayHostId}`
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
        credentialKind: 'resume',
        acceptedCredentialVersion: 1,
        acceptedAs: 'current'
      })

      phoneSocket.close()
      client2.closeNow()
      await server2.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('Case 3: Current-to-grace rotation remains atomic and both tokens produce strict existing resume hello metadata', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-task5-c3-'))
    const dbPath = join(dir, 'relay-security.db')

    try {
      const securityState1 = openOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: true })
      const server1 = await listenOwnMobileRelay({
        operator: TEST_OPERATOR,
        securityState: securityState1,
        origin: 'http://127.0.0.1'
      })

      const rawToken1 = generateRawResumeToken()
      const tokenHash1 = sha256Base64Url(rawToken1)
      const rawToken2 = generateRawResumeToken()
      const tokenHash2 = sha256Base64Url(rawToken2)

      const { client: client1, relayHostId, keypair } = await setupRelayClient(server1.origin)
      await client1.installCredential({
        reqId: 'req-rot-1',
        relayDeviceId: 'device-rot-1',
        newResumeTokenHash: tokenHash1,
        authorization: { mode: 'relay-basis', basisConnId: 'conn-1' }
      })

      const rotated = await client1.installCredential({
        reqId: 'req-rot-2',
        relayDeviceId: 'device-rot-1',
        newResumeTokenHash: tokenHash2,
        expectedCurrentHash: tokenHash1,
        authorization: { mode: 'relay-basis', basisConnId: 'conn-1' }
      })
      expect(rotated.currentVersion).toBe(2)
      expect(rotated.graceExpiresAt).toBeDefined()

      client1.closeNow()
      await server1.close()

      const securityState2 = openOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: true })
      const server2 = await listenOwnMobileRelay({
        operator: TEST_OPERATOR,
        securityState: securityState2,
        origin: 'http://127.0.0.1'
      })

      const { client: hostClient1 } = await setupRelayClient(server2.origin, undefined, keypair)
      const phoneWsUrl = `${server2.origin.replace('http://', 'ws://')}/v1/connect/${relayHostId}`
      const phone1 = new WebSocket(phoneWsUrl)
      await waitForOpen(phone1)
      const helloPromise1 = nextJson(phone1)
      phone1.send(
        JSON.stringify({
          type: 'relay-auth',
          v: 1,
          mode: 'connect',
          credential: rawToken2
        })
      )
      const hello1Raw = await helloPromise1
      const parsedHello1 = RelayPhoneHelloSchema.safeParse(hello1Raw)
      expect(parsedHello1.success).toBe(true)
      expect(hello1Raw).toMatchObject({
        type: 'relay-hello',
        ok: true,
        credentialKind: 'resume',
        acceptedCredentialVersion: 2,
        acceptedAs: 'current',
        resumeExpiresAt: rotated.resumeExpiresAt
      })
      expect((hello1Raw as Record<string, unknown>).graceExpiresAt).toBeUndefined()
      phone1.close()
      hostClient1.closeNow()

      const { client: hostClient2 } = await setupRelayClient(server2.origin, undefined, keypair)
      const phone2 = new WebSocket(phoneWsUrl)
      await waitForOpen(phone2)
      const helloPromise2 = nextJson(phone2)
      phone2.send(
        JSON.stringify({
          type: 'relay-auth',
          v: 1,
          mode: 'connect',
          credential: rawToken1
        })
      )
      const hello2Raw = await helloPromise2
      const parsedHello2 = RelayPhoneHelloSchema.safeParse(hello2Raw)
      expect(parsedHello2.success).toBe(true)
      expect(hello2Raw).toMatchObject({
        type: 'relay-hello',
        ok: true,
        credentialKind: 'resume',
        acceptedCredentialVersion: 2,
        acceptedAs: 'grace',
        resumeExpiresAt: rotated.resumeExpiresAt,
        graceExpiresAt: rotated.graceExpiresAt
      })
      phone2.close()
      hostClient2.closeNow()

      await server2.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('Case 4: Resume resolve and WebSocket admission reject expired/revoked credentials after restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-task5-c4-'))
    const dbPath = join(dir, 'relay-security.db')

    try {
      const securityState1 = openOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: true })
      const server1 = await listenOwnMobileRelay({
        operator: TEST_OPERATOR,
        securityState: securityState1,
        origin: 'http://127.0.0.1'
      })

      const { client: hostClient, relayHostId, keypair } = await setupRelayClient(server1.origin)
      const rawTokenExpired = generateRawResumeToken()
      const hashExpired = sha256Base64Url(rawTokenExpired)

      await securityState1.installDeviceCredential(
        {
          relayHostId,
          relayDeviceId: 'dev-exp-c4',
          reqId: 'req-exp-1',
          newResumeTokenHash: hashExpired,
          authorizationMode: 'relay-basis',
          resumeTtlMs: 1,
          graceTtlMs: 1
        },
        Date.now() - 5000
      )
      hostClient.closeNow()
      await server1.close()

      const securityState2 = openOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: true })
      const server2 = await listenOwnMobileRelay({
        operator: TEST_OPERATOR,
        securityState: securityState2,
        origin: 'http://127.0.0.1'
      })

      const resolveRes = await fetch(`${server2.origin}/v1/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          v: 1,
          relayHostId,
          resumeToken: rawTokenExpired
        })
      })
      expect(resolveRes.status).toBe(401)

      const { client: hostClient2 } = await setupRelayClient(server2.origin, undefined, keypair)

      const phoneWsUrl = `${server2.origin.replace('http://', 'ws://')}/v1/connect/${relayHostId}`
      const phoneSocket = new WebSocket(phoneWsUrl)
      await waitForOpen(phoneSocket)

      const helloPromise = nextJson(phoneSocket)
      const closePromise = nextClose(phoneSocket)
      phoneSocket.send(
        JSON.stringify({
          type: 'relay-auth',
          v: 1,
          mode: 'connect',
          credential: rawTokenExpired
        })
      )
      const hello = await helloPromise
      expect(hello).toMatchObject({ type: 'relay-hello', ok: false, code: 4401 })
      const close = await closePromise
      expect(close.code).toBe(4401)

      hostClient2.closeNow()
      await server2.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('Case 5: Device revoke persists after restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-task5-c5-'))
    const dbPath = join(dir, 'relay-security.db')

    try {
      const securityState1 = openOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: true })
      const server1 = await listenOwnMobileRelay({
        operator: TEST_OPERATOR,
        securityState: securityState1,
        origin: 'http://127.0.0.1'
      })

      const rawToken = generateRawResumeToken()
      const tokenHash = sha256Base64Url(rawToken)

      const { client: client1, relayHostId, keypair } = await setupRelayClient(server1.origin)
      await client1.installCredential({
        reqId: 'req-install-c5',
        relayDeviceId: 'device-to-revoke-1',
        newResumeTokenHash: tokenHash,
        authorization: { mode: 'relay-basis', basisConnId: 'conn-1' }
      })

      await client1.revokeDevice('device-to-revoke-1', 'req-rev-c5')

      client1.closeNow()
      await server1.close()

      const securityState2 = openOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: true })
      const server2 = await listenOwnMobileRelay({
        operator: TEST_OPERATOR,
        securityState: securityState2,
        origin: 'http://127.0.0.1'
      })

      const { client: client2 } = await setupRelayClient(server2.origin, undefined, keypair)
      const status = await client2.credentialInstallStatus('device-to-revoke-1', 'req-stat-c5')
      expect(status).toMatchObject({
        v: 1,
        type: 'device-credential-install-status-result',
        state: 'not-found'
      })

      const resolveRes = await fetch(`${server2.origin}/v1/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          v: 1,
          relayHostId,
          resumeToken: rawToken
        })
      })
      expect(resolveRes.status).toBe(401)

      const phoneWsUrl = `${server2.origin.replace('http://', 'ws://')}/v1/connect/${relayHostId}`
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
      expect(hello).toMatchObject({ type: 'relay-hello', ok: false, code: 4401 })
      const close = await closePromise
      expect(close.code).toBe(4401)

      client2.closeNow()
      await server2.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('Case 6: Password epoch advancement leaves device resume valid after a new desktop control session is established', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-task5-c6-'))
    const dbPath = join(dir, 'relay-security.db')

    try {
      const securityState = openOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: true })
      const server = await listenOwnMobileRelay({
        operator: TEST_OPERATOR,
        securityState,
        origin: 'http://127.0.0.1'
      })

      const rawToken = generateRawResumeToken()
      const tokenHash = sha256Base64Url(rawToken)

      let connOpenMsg: { connId: string; connTicket: string; kind: string } | null = null
      const {
        client: oldClient,
        relayHostId,
        keypair,
        identity
      } = await setupRelayClient(server.origin, {
        onConnectionOpen: (msg) => {
          connOpenMsg = msg
        }
      })

      await oldClient.installCredential({
        reqId: 'req-install-c6',
        relayDeviceId: 'device-epoch-1',
        newResumeTokenHash: tokenHash,
        authorization: { mode: 'relay-basis', basisConnId: 'conn-1' }
      })

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

      oldClient.closeNow()

      const newSessionToken = await loginAndObtainSessionToken(server.origin, {
        ...TEST_OPERATOR,
        password: 'any'
      }).catch(async () => {
        await securityState.issueAccessSession({
          rawAccessToken: 'new-access-token-c6',
          identity: {
            userId: TEST_OPERATOR.userId,
            profileId: TEST_OPERATOR.profileId,
            organizationId: TEST_OPERATOR.organizationId,
            email: TEST_OPERATOR.email,
            cloudProfileId: TEST_OPERATOR.profileId
          },
          ttlMs: 3600_000
        })
        return 'new-access-token-c6'
      })

      const tokenRes = await fetch(`${server.origin}/v1/desktop/auth/relay-token`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${newSessionToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          relayHostId,
          hostPublicKeyB64: keypair.publicKeyB64
        })
      })
      const { relayToken: newRelayToken } = (await tokenRes.json()) as { relayToken: string }

      const assignRes = await fetch(`${server.origin}/v1/assign`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${newRelayToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ v: 1, relayHostId })
      })
      const { cellUrl, assignmentEpoch } = (await assignRes.json()) as {
        cellUrl: string
        assignmentEpoch: number
      }

      connOpenMsg = null
      const newClient = new RelayControlClient({
        cellUrl,
        relayJwt: newRelayToken,
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
      await newClient.connect()

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
        acceptedAs: 'current'
      })

      await vi.waitFor(() => expect(connOpenMsg).not.toBeNull())
      expect(connOpenMsg).toMatchObject({
        type: 'conn-open',
        kind: 'resume',
        relayDeviceId: 'device-epoch-1'
      })

      phoneSocket.close()
      newClient.closeNow()
      await server.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('Case 7: Resume confirmation after host-data attach retains the basisConnId invariant from e754ea982c', async () => {
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
        reqId: 'req-inst-c7',
        relayDeviceId: 'device-basis-1',
        newResumeTokenHash: tokenHash,
        authorization: { mode: 'relay-basis', basisConnId: 'conn-basis-1' }
      })

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
      await helloPromise

      await vi.waitFor(() => expect(connOpenMsg).not.toBeNull())
      const { connId, connTicket } = connOpenMsg!

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

      const confirmRes = await client.confirmResume(connId, 'req-confirm-c7')
      expect(confirmRes).toMatchObject({
        v: 1,
        type: 'device-resume-confirmed',
        currentVersion: 1,
        acceptedAs: 'current',
        renewed: false
      })

      const hostReceivedText = nextFrame(hostDataSocket)
      phoneSocket.send('post-attach-splice-test')
      const hostMsg = await hostReceivedText
      expect(hostMsg.data).toBe('post-attach-splice-test')

      hostDataSocket.close()
      phoneSocket.close()
      client.closeNow()
    } finally {
      await server.close()
    }
  })

  it('Case 8: Invite pairing remains ephemeral and unchanged', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-task5-c8-'))
    const dbPath = join(dir, 'relay-security.db')

    try {
      const securityState1 = openOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: true })
      const server1 = await listenOwnMobileRelay({
        operator: TEST_OPERATOR,
        securityState: securityState1,
        origin: 'http://127.0.0.1'
      })

      const { client: client1, relayHostId, keypair } = await setupRelayClient(server1.origin)
      const invite = await client1.createInvite('device-inv-1')
      expect(invite.inviteToken).toBeDefined()

      client1.closeNow()
      await server1.close()

      const securityState2 = openOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: true })
      const server2 = await listenOwnMobileRelay({
        operator: TEST_OPERATOR,
        securityState: securityState2,
        origin: 'http://127.0.0.1'
      })

      const { client: hostClient2 } = await setupRelayClient(server2.origin, undefined, keypair)
      const phoneWsUrl = `${server2.origin.replace('http://', 'ws://')}/v1/connect/${relayHostId}`
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
      expect(hello).toMatchObject({ type: 'relay-hello', ok: false, code: 4401 })
      const close = await closePromise
      expect(close.code).toBe(4401)

      hostClient2.closeNow()
      await server2.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
