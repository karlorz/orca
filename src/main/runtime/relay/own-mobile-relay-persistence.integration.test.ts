import { describe, expect, it, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import nacl from 'tweetnacl'
import WebSocket from 'ws'
import { startOwnRelayServer, parseOwnRelayServeConfig } from './own-mobile-relay-main'
import { TEST_FAST_PASSWORD_POLICY } from './own-mobile-relay-password'
import { deriveRelayHostId } from './relay-http-client'
import { RelayControlClient } from './relay-control-client'
import { openOwnMobileRelaySecurityStateSqlite } from './own-mobile-relay-security-state-sqlite'

function sha256Base64Url(raw: string): string {
  return createHash('sha256').update(raw).digest('base64url')
}

function generateRawResumeToken(): string {
  return randomBytes(32).toString('base64url')
}

function nextJson(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    socket.once('message', (raw) => resolve(JSON.parse(raw.toString())))
  })
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
}

function waitForClose(socket: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    socket.once('close', (code, reason) => {
      resolve({ code, reason: reason.toString() })
    })
  })
}

describe('own-mobile-relay-persistence.integration (Scenario 1 & 4)', () => {
  const tempDirs: string[] = []

  function createTempDbPath(): string {
    const dir = mkdtempSync(join(tmpdir(), 'relay-acceptance-'))
    tempDirs.push(dir)
    return join(dir, 'relay.db')
  }

  afterEach(() => {
    for (const dir of tempDirs) {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        // ignore
      }
    }
    tempDirs.length = 0
  })

  it('Scenario 1: Bootstrap, PKCE, grant, device install, close/reopen without bootstrap, profile/capabilities/assignment/control/resolve/phone resume', async () => {
    const dbPath = createTempDbPath()
    const operatorPassword = 'acceptance-secret-password-123!'
    const operatorEmail = 'acceptance-op@example.com'
    const operatorUserId = 'user-acc-1'
    const operatorProfileId = 'prof-acc-1'
    const operatorOrgId = 'org-acc-1'
    const clientId = 'orca-desktop'

    // 1. Initial startup with bootstrap credentials
    const bootstrapEnv = {
      OWN_RELAY_STATE_PATH: dbPath,
      OWN_RELAY_ORIGIN: 'http://127.0.0.1',
      OWN_RELAY_AUTH_ORIGIN: 'http://127.0.0.1',
      OWN_RELAY_CLIENT_ID: clientId,
      OWN_RELAY_LISTEN_PORT: '0',
      OWN_RELAY_OPERATOR_EMAIL: operatorEmail,
      OWN_RELAY_OPERATOR_PASSWORD: operatorPassword,
      OWN_RELAY_OPERATOR_USER_ID: operatorUserId,
      OWN_RELAY_OPERATOR_PROFILE_ID: operatorProfileId,
      OWN_RELAY_OPERATOR_ORG_ID: operatorOrgId
    }

    const config1 = parseOwnRelayServeConfig(bootstrapEnv)
    const serverInstance1 = await startOwnRelayServer({
      config: config1,
      passwordPolicy: TEST_FAST_PASSWORD_POLICY
    })
    const origin1 = `http://127.0.0.1:${serverInstance1.boundPort}`

    const hostKeypair = nacl.box.keyPair()
    const hostPublicKeyB64 = Buffer.from(hostKeypair.publicKey).toString('base64')
    const relayHostId = deriveRelayHostId(hostKeypair.publicKey)

    const rawResumeToken = generateRawResumeToken()
    const resumeTokenHash = sha256Base64Url(rawResumeToken)
    const phoneDeviceId = 'dev-phone-acc-1'

    let accessToken1: string
    let relayToken1: string

    try {
      // PKCE Sign in
      const verifier = 'test-code-verifier-string-scenario1-12345678901234567890'
      const challenge = Buffer.from(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
      ).toString('base64url')

      const authQuery = new URLSearchParams({
        client_id: clientId,
        redirect_uri: 'http://127.0.0.1:4000/auth/callback',
        code_challenge_method: 'S256',
        code_challenge: challenge,
        response_type: 'code',
        state: 'st-1',
        nonce: 'no-1'
      }).toString()

      const loginRes = await fetch(`${origin1}/v1/desktop/auth/authorize?${authQuery}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          email: operatorEmail,
          password: operatorPassword
        }).toString(),
        redirect: 'manual'
      })
      expect(loginRes.status).toBe(302)
      const loc = new URL(loginRes.headers.get('location')!)
      const code = loc.searchParams.get('code')!

      const sessionRes = await fetch(`${origin1}/v1/desktop/auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code,
          codeVerifier: verifier,
          redirectUri: 'http://127.0.0.1:4000/auth/callback'
        })
      })
      expect(sessionRes.status).toBe(200)
      const sessionBody = (await sessionRes.json()) as { accessToken: string }
      accessToken1 = sessionBody.accessToken

      // Issue grant (Relay token)
      const tokenRes = await fetch(`${origin1}/v1/desktop/auth/relay-token`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken1}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          relayHostId,
          hostPublicKeyB64
        })
      })
      expect(tokenRes.status).toBe(200)
      const tokenBody = (await tokenRes.json()) as { relayToken: string }
      relayToken1 = tokenBody.relayToken

      // Control client 1 connects to install device credential
      const assignRes1 = await fetch(`${origin1}/v1/assign`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${relayToken1}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ v: 1, relayHostId })
      })
      expect(assignRes1.status).toBe(200)
      const assign1 = (await assignRes1.json()) as { cellUrl: string; assignmentEpoch: number }

      const client1 = new RelayControlClient({
        cellUrl: assign1.cellUrl,
        relayJwt: relayToken1,
        relayHostId,
        assignmentEpoch: assign1.assignmentEpoch,
        identity: {
          userId: operatorUserId,
          profileId: operatorProfileId,
          organizationId: operatorOrgId
        },
        keypair: {
          publicKey: hostKeypair.publicKey,
          secretKey: hostKeypair.secretKey,
          publicKeyB64: hostPublicKeyB64
        },
        appVersion: '0.0.0-test',
        onClose: vi.fn(),
        onConnectionOpen: vi.fn(),
        onDrain: vi.fn()
      })
      await client1.connect()

      const installed = await client1.installCredential({
        reqId: 'req-install-acc-1',
        relayDeviceId: phoneDeviceId,
        newResumeTokenHash: resumeTokenHash,
        authorization: { mode: 'relay-basis', basisConnId: 'conn-1' }
      })
      expect(installed.currentVersion).toBe(1)

      client1.closeNow()
    } finally {
      await serverInstance1.close()
    }

    // 2. Reopen server with SAME SQLite DB and NO bootstrap variables
    const restartEnv = {
      OWN_RELAY_STATE_PATH: dbPath,
      OWN_RELAY_ORIGIN: 'http://127.0.0.1',
      OWN_RELAY_AUTH_ORIGIN: 'http://127.0.0.1',
      OWN_RELAY_CLIENT_ID: clientId,
      OWN_RELAY_LISTEN_PORT: '0'
      // No OWN_RELAY_OPERATOR_* variables
    }

    const config2 = parseOwnRelayServeConfig(restartEnv)
    const serverInstance2 = await startOwnRelayServer({
      config: config2,
      passwordPolicy: TEST_FAST_PASSWORD_POLICY
    })
    const origin2 = `http://127.0.0.1:${serverInstance2.boundPort}`

    let client2: RelayControlClient | undefined
    let phoneSocket: WebSocket | undefined

    try {
      // Prove profile and capabilities work with existing accessToken across restart
      const capRes = await fetch(`${origin2}/v1/desktop/auth/capabilities`, {
        headers: { authorization: `Bearer ${accessToken1}` }
      })
      expect(capRes.status).toBe(200)
      const capBody = (await capRes.json()) as {
        capabilities: { flags: { 'relay.use': boolean } }
      }
      expect(capBody.capabilities.flags['relay.use']).toBe(true)

      const profRes = await fetch(`${origin2}/v1/desktop/auth/profile`, {
        headers: { authorization: `Bearer ${accessToken1}` }
      })
      expect(profRes.status).toBe(200)
      const profBody = (await profRes.json()) as { email: string; userId: string }
      expect(profBody.email).toBe(operatorEmail)
      expect(profBody.userId).toBe(operatorUserId)

      // Prove assignment works with existing relayToken across restart
      const assignRes2 = await fetch(`${origin2}/v1/assign`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${relayToken1}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ v: 1, relayHostId })
      })
      expect(assignRes2.status).toBe(200)
      const assign2 = (await assignRes2.json()) as { cellUrl: string; assignmentEpoch: number }

      // Connect control client across restart
      client2 = new RelayControlClient({
        cellUrl: assign2.cellUrl,
        relayJwt: relayToken1,
        relayHostId,
        assignmentEpoch: assign2.assignmentEpoch,
        identity: {
          userId: operatorUserId,
          profileId: operatorProfileId,
          organizationId: operatorOrgId
        },
        keypair: {
          publicKey: hostKeypair.publicKey,
          secretKey: hostKeypair.secretKey,
          publicKeyB64: hostPublicKeyB64
        },
        appVersion: '0.0.0-test',
        onClose: vi.fn(),
        onConnectionOpen: vi.fn(),
        onDrain: vi.fn()
      })
      await client2.connect()

      // Device status shows committed
      const status = await client2.credentialInstallStatus(phoneDeviceId, 'req-status-acc-1')
      expect(status).toMatchObject({
        v: 1,
        type: 'device-credential-install-status-result',
        state: 'committed',
        result: {
          v: 1,
          currentVersion: 1
        }
      })

      // Phone connects with resume token and resumes session
      const phoneWsUrl = `${origin2.replace('http://', 'ws://')}/v1/connect/${relayHostId}`
      phoneSocket = new WebSocket(phoneWsUrl)
      await waitForOpen(phoneSocket)
      const helloPromise = nextJson(phoneSocket)
      phoneSocket.send(
        JSON.stringify({
          type: 'relay-auth',
          v: 1,
          mode: 'connect',
          credential: rawResumeToken
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
    } finally {
      phoneSocket?.close()
      client2?.closeNow()
      await serverInstance2.close()
    }
  })

  it('Scenario 4: Logout and independent session/grant/device expiries deny admission after restart', async () => {
    const dbPath = createTempDbPath()
    const operatorPassword = 'acceptance-secret-password-444!'
    const operatorEmail = 'expiry-op@example.com'
    const operatorUserId = 'user-exp-1'
    const operatorProfileId = 'prof-exp-1'
    const operatorOrgId = 'org-exp-1'
    const clientId = 'orca-desktop'

    const bootstrapEnv = {
      OWN_RELAY_STATE_PATH: dbPath,
      OWN_RELAY_ORIGIN: 'http://127.0.0.1',
      OWN_RELAY_AUTH_ORIGIN: 'http://127.0.0.1',
      OWN_RELAY_CLIENT_ID: clientId,
      OWN_RELAY_LISTEN_PORT: '0',
      OWN_RELAY_OPERATOR_EMAIL: operatorEmail,
      OWN_RELAY_OPERATOR_PASSWORD: operatorPassword,
      OWN_RELAY_OPERATOR_USER_ID: operatorUserId,
      OWN_RELAY_OPERATOR_PROFILE_ID: operatorProfileId,
      OWN_RELAY_OPERATOR_ORG_ID: operatorOrgId
    }

    // 1. Initial server instance to issue credentials and perform logout / expirations
    const config1 = parseOwnRelayServeConfig(bootstrapEnv)
    const serverInstance1 = await startOwnRelayServer({
      config: config1,
      passwordPolicy: TEST_FAST_PASSWORD_POLICY
    })
    const origin1 = `http://127.0.0.1:${serverInstance1.boundPort}`

    const hostKeypair = nacl.box.keyPair()
    const hostPublicKeyB64 = Buffer.from(hostKeypair.publicKey).toString('base64')
    const relayHostId = deriveRelayHostId(hostKeypair.publicKey)

    let loggedOutAccessToken: string

    try {
      // 1a. Sign in session A (to be logged out)
      const verifierA = 'test-verifier-a-123456789012345678901234567890'
      const challengeA = Buffer.from(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifierA))
      ).toString('base64url')

      const authQueryA = new URLSearchParams({
        client_id: clientId,
        redirect_uri: 'http://127.0.0.1:4000/auth/callback',
        code_challenge_method: 'S256',
        code_challenge: challengeA,
        response_type: 'code'
      }).toString()

      const loginResA = await fetch(`${origin1}/v1/desktop/auth/authorize?${authQueryA}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          email: operatorEmail,
          password: operatorPassword
        }).toString(),
        redirect: 'manual'
      })
      const codeA = new URL(loginResA.headers.get('location')!).searchParams.get('code')!

      const sessionResA = await fetch(`${origin1}/v1/desktop/auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code: codeA,
          codeVerifier: verifierA,
          redirectUri: 'http://127.0.0.1:4000/auth/callback'
        })
      })
      const { accessToken: tokenA } = (await sessionResA.json()) as { accessToken: string }
      loggedOutAccessToken = tokenA

      // Perform logout on Session A
      const logoutRes = await fetch(`${origin1}/v1/desktop/auth/logout`, {
        method: 'POST',
        headers: { authorization: `Bearer ${loggedOutAccessToken}` }
      })
      expect(logoutRes.status).toBe(200)

      // 1b. Sign in session B (active, used to issue expired records directly to state)
      const verifierB = 'test-verifier-b-123456789012345678901234567890'
      const challengeB = Buffer.from(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifierB))
      ).toString('base64url')

      const authQueryB = new URLSearchParams({
        client_id: clientId,
        redirect_uri: 'http://127.0.0.1:4000/auth/callback',
        code_challenge_method: 'S256',
        code_challenge: challengeB,
        response_type: 'code'
      }).toString()

      const loginResB = await fetch(`${origin1}/v1/desktop/auth/authorize?${authQueryB}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          email: operatorEmail,
          password: operatorPassword
        }).toString(),
        redirect: 'manual'
      })
      const codeB = new URL(loginResB.headers.get('location')!).searchParams.get('code')!

      await fetch(`${origin1}/v1/desktop/auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code: codeB,
          codeVerifier: verifierB,
          redirectUri: 'http://127.0.0.1:4000/auth/callback'
        })
      })
    } finally {
      await serverInstance1.close()
    }

    // Directly seed expired session, expired grant, and expired device credential into SQLite
    const stateDirect = openOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: true })

    const expiredAccessToken = 'expired-raw-access-token-999'
    await stateDirect.issueAccessSession({
      rawAccessToken: expiredAccessToken,
      identity: {
        userId: operatorUserId,
        profileId: operatorProfileId,
        organizationId: operatorOrgId,
        email: operatorEmail,
        cloudProfileId: operatorProfileId
      },
      ttlMs: -10_000
    })

    const parentSession = await stateDirect.issueAccessSession({
      rawAccessToken: 'parent-for-grant-expiry',
      identity: {
        userId: operatorUserId,
        profileId: operatorProfileId,
        organizationId: operatorOrgId,
        email: operatorEmail,
        cloudProfileId: operatorProfileId
      },
      ttlMs: 60_000
    })

    const expiredRelayToken = 'expired-raw-relay-token-888'
    await stateDirect.issueRelayGrant({
      rawRelayToken: expiredRelayToken,
      parentSessionId: parentSession.sessionId,
      relayHostId,
      hostPublicKeyB64,
      identity: {
        userId: operatorUserId,
        profileId: operatorProfileId,
        organizationId: operatorOrgId
      },
      ttlMs: -10_000
    })

    const expiredResumeToken = generateRawResumeToken()
    const expiredResumeTokenHash = sha256Base64Url(expiredResumeToken)
    const expiredPhoneDeviceId = 'dev-expired-phone-999'

    await stateDirect.installDeviceCredential({
      relayHostId,
      relayDeviceId: expiredPhoneDeviceId,
      reqId: 'req-expired-dev',
      newResumeTokenHash: expiredResumeTokenHash,
      authorizationMode: 'relay-basis',
      resumeTtlMs: -10_000
    })

    await stateDirect.close()

    // 2. Reopen server with SAME SQLite DB and NO bootstrap variables
    const restartEnv = {
      OWN_RELAY_STATE_PATH: dbPath,
      OWN_RELAY_ORIGIN: 'http://127.0.0.1',
      OWN_RELAY_AUTH_ORIGIN: 'http://127.0.0.1',
      OWN_RELAY_CLIENT_ID: clientId,
      OWN_RELAY_LISTEN_PORT: '0'
    }

    const config2 = parseOwnRelayServeConfig(restartEnv)
    const serverInstance2 = await startOwnRelayServer({
      config: config2,
      passwordPolicy: TEST_FAST_PASSWORD_POLICY
    })
    const origin2 = `http://127.0.0.1:${serverInstance2.boundPort}`

    try {
      // 2a. Logged-out session denied after restart
      const loggedOutRes = await fetch(`${origin2}/v1/desktop/auth/capabilities`, {
        headers: { authorization: `Bearer ${loggedOutAccessToken}` }
      })
      expect(loggedOutRes.status).toBe(401)

      // 2b. Expired session denied after restart
      const expiredSessionRes = await fetch(`${origin2}/v1/desktop/auth/capabilities`, {
        headers: { authorization: `Bearer ${expiredAccessToken}` }
      })
      expect(expiredSessionRes.status).toBe(401)

      // 2c. Expired relay grant denied after restart
      const expiredGrantRes = await fetch(`${origin2}/v1/assign`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${expiredRelayToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ v: 1, relayHostId })
      })
      expect(expiredGrantRes.status).toBe(401)

      // 2d. Expired device resume token denied on phone resume after restart
      const phoneWsUrl = `${origin2.replace('http://', 'ws://')}/v1/connect/${relayHostId}`
      const phoneSocket = new WebSocket(phoneWsUrl)
      await waitForOpen(phoneSocket)
      const closePromise = waitForClose(phoneSocket)
      phoneSocket.send(
        JSON.stringify({
          type: 'relay-auth',
          v: 1,
          mode: 'connect',
          credential: expiredResumeToken
        })
      )
      const closeResult = await closePromise
      expect(closeResult.code).toBe(4404)
    } finally {
      await serverInstance2.close()
    }
  })
})
