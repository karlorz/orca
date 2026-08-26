import { describe, expect, it, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import nacl from 'tweetnacl'
import { startOwnRelayServer, parseOwnRelayServeConfig } from './own-mobile-relay-main'
import { TEST_FAST_PASSWORD_POLICY } from './own-mobile-relay-password'
import { deriveRelayHostId } from './relay-http-client'
import { RelayControlClient } from './relay-control-client'

function sha256Base64Url(raw: string): string {
  return createHash('sha256').update(raw).digest('base64url')
}

function generateRawResumeToken(): string {
  return randomBytes(32).toString('base64url')
}

describe('own-mobile-relay-secret-absence.integration (Scenario 6)', () => {
  const tempDirs: string[] = []

  function createTempDbPath(): string {
    const dir = mkdtempSync(join(tmpdir(), 'relay-secrets-'))
    tempDirs.push(dir)
    return join(dir, 'relay.db')
  }

  afterEach(() => {
    vi.restoreAllMocks()
    for (const dir of tempDirs) {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        // ignore
      }
    }
    tempDirs.length = 0
  })

  it('Scenario 6: DB + WAL checkpoint byte scan contains none of fixture raw password/access/Relay/resume tokens', async () => {
    const dbPath = createTempDbPath()
    const rawPasswordSecret = 'CONFIDENTIAL_SECRET_PASSWORD_9876543210_XYZ'
    const rawResumeSecret = generateRawResumeToken()
    const resumeTokenHash = sha256Base64Url(rawResumeSecret)

    const operatorEmail = 'secret-scan-op@example.com'
    const operatorUserId = 'user-sec-scan-1'
    const operatorProfileId = 'prof-sec-scan-1'
    const operatorOrgId = 'org-sec-scan-1'
    const clientId = 'orca-desktop'

    const env = {
      OWN_RELAY_STATE_PATH: dbPath,
      OWN_RELAY_ORIGIN: 'http://127.0.0.1',
      OWN_RELAY_AUTH_ORIGIN: 'http://127.0.0.1',
      OWN_RELAY_CLIENT_ID: clientId,
      OWN_RELAY_LISTEN_PORT: '0',
      OWN_RELAY_OPERATOR_EMAIL: operatorEmail,
      OWN_RELAY_OPERATOR_PASSWORD: rawPasswordSecret,
      OWN_RELAY_OPERATOR_USER_ID: operatorUserId,
      OWN_RELAY_OPERATOR_PROFILE_ID: operatorProfileId,
      OWN_RELAY_OPERATOR_ORG_ID: operatorOrgId
    }

    const config = parseOwnRelayServeConfig(env)
    const serverInstance = await startOwnRelayServer({
      config,
      passwordPolicy: TEST_FAST_PASSWORD_POLICY
    })
    const origin = `http://127.0.0.1:${serverInstance.boundPort}`

    const hostKeypair = nacl.box.keyPair()
    const hostPublicKeyB64 = Buffer.from(hostKeypair.publicKey).toString('base64')
    const relayHostId = deriveRelayHostId(hostKeypair.publicKey)

    let rawAccessToken: string
    let rawRelayToken: string

    try {
      // 1. PKCE exchange to get raw access token
      const verifier = 'test-verifier-secrets-scan-12345678901234567890123456'
      const challenge = Buffer.from(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
      ).toString('base64url')

      const authQuery = new URLSearchParams({
        client_id: clientId,
        redirect_uri: 'http://127.0.0.1:4000/auth/callback',
        code_challenge_method: 'S256',
        code_challenge: challenge,
        response_type: 'code'
      }).toString()

      const loginRes = await fetch(`${origin}/v1/desktop/auth/authorize?${authQuery}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          email: operatorEmail,
          password: rawPasswordSecret
        }).toString(),
        redirect: 'manual'
      })
      const code = new URL(loginRes.headers.get('location')!).searchParams.get('code')!

      const sessionRes = await fetch(`${origin}/v1/desktop/auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code,
          codeVerifier: verifier,
          redirectUri: 'http://127.0.0.1:4000/auth/callback'
        })
      })
      const sessionBody = (await sessionRes.json()) as { accessToken: string }
      rawAccessToken = sessionBody.accessToken

      // 2. Issue Relay token
      const tokenRes = await fetch(`${origin}/v1/desktop/auth/relay-token`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${rawAccessToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          relayHostId,
          hostPublicKeyB64
        })
      })
      const tokenBody = (await tokenRes.json()) as { relayToken: string }
      rawRelayToken = tokenBody.relayToken

      // 3. Control client connects and installs device credential
      const assignRes = await fetch(`${origin}/v1/assign`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${rawRelayToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ v: 1, relayHostId })
      })
      const assign = (await assignRes.json()) as { cellUrl: string; assignmentEpoch: number }

      const controlClient = new RelayControlClient({
        cellUrl: assign.cellUrl,
        relayJwt: rawRelayToken,
        relayHostId,
        assignmentEpoch: assign.assignmentEpoch,
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
      await controlClient.connect()

      await controlClient.installCredential({
        reqId: 'req-install-sec-1',
        relayDeviceId: 'dev-phone-sec-1',
        newResumeTokenHash: resumeTokenHash,
        authorization: { mode: 'relay-basis', basisConnId: 'conn-1' }
      })

      controlClient.closeNow()
    } finally {
      await serverInstance.close()
    }

    // 4. Read DB and WAL file bytes
    const dbBytes = readFileSync(dbPath)
    const walPath = `${dbPath}-wal`
    const walBytes = existsSync(walPath) ? readFileSync(walPath) : Buffer.alloc(0)
    const combinedBytes = Buffer.concat([dbBytes, walBytes])

    // Scan for raw password, raw access token, raw relay token, raw resume token
    expect(combinedBytes.includes(Buffer.from(rawPasswordSecret))).toBe(false)
    expect(combinedBytes.includes(Buffer.from(rawAccessToken))).toBe(false)
    expect(combinedBytes.includes(Buffer.from(rawRelayToken))).toBe(false)
    expect(combinedBytes.includes(Buffer.from(rawResumeSecret))).toBe(false)
  })
})
