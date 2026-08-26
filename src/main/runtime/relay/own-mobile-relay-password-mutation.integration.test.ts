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
import { runAccountCli, type AccountCliPromptInterface } from './own-mobile-relay-account-cli'

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

describe('own-mobile-relay-password-mutation.integration (Scenario 2 & 3)', () => {
  const tempDirs: string[] = []

  function createTempDbPath(): string {
    const dir = mkdtempSync(join(tmpdir(), 'relay-mutation-'))
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

  it('Scenario 2: Password change through browser invalidates old session/grant/control and preserves phone credential; new login restores control and phone resumes without re-pair', async () => {
    const dbPath = createTempDbPath()
    const initialPassword = 'old-secret-password-123!'
    const newPassword = 'brand-new-secret-password-456!'
    const operatorEmail = 'mutation-op@example.com'
    const operatorUserId = 'user-mut-1'
    const operatorProfileId = 'prof-mut-1'
    const operatorOrgId = 'org-mut-1'
    const clientId = 'orca-desktop'
    const silenceLimitMs = 60

    const env = {
      OWN_RELAY_STATE_PATH: dbPath,
      OWN_RELAY_ORIGIN: 'http://127.0.0.1',
      OWN_RELAY_AUTH_ORIGIN: 'http://127.0.0.1',
      OWN_RELAY_CLIENT_ID: clientId,
      OWN_RELAY_LISTEN_PORT: '0',
      OWN_RELAY_OPERATOR_EMAIL: operatorEmail,
      OWN_RELAY_OPERATOR_PASSWORD: initialPassword,
      OWN_RELAY_OPERATOR_USER_ID: operatorUserId,
      OWN_RELAY_OPERATOR_PROFILE_ID: operatorProfileId,
      OWN_RELAY_OPERATOR_ORG_ID: operatorOrgId
    }

    const config = parseOwnRelayServeConfig(env)
    const serverInstance = await startOwnRelayServer({
      config,
      silenceLimitMs,
      passwordPolicy: TEST_FAST_PASSWORD_POLICY
    })
    const origin = `http://127.0.0.1:${serverInstance.boundPort}`

    const hostKeypair = nacl.box.keyPair()
    const hostPublicKeyB64 = Buffer.from(hostKeypair.publicKey).toString('base64')
    const relayHostId = deriveRelayHostId(hostKeypair.publicKey)

    const rawResumeToken = generateRawResumeToken()
    const resumeTokenHash = sha256Base64Url(rawResumeToken)
    const phoneDeviceId = 'dev-phone-mut-1'

    let oldControlClient: RelayControlClient | undefined
    let newControlClient: RelayControlClient | undefined
    let phoneSocket: WebSocket | undefined

    try {
      // 1. Initial Login & Session 1
      const verifier1 = 'test-verifier-scenario2-initial-12345678901234567890'
      const challenge1 = Buffer.from(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier1))
      ).toString('base64url')

      const authQuery1 = new URLSearchParams({
        client_id: clientId,
        redirect_uri: 'http://127.0.0.1:4000/auth/callback',
        code_challenge_method: 'S256',
        code_challenge: challenge1,
        response_type: 'code'
      }).toString()

      const loginRes1 = await fetch(`${origin}/v1/desktop/auth/authorize?${authQuery1}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          email: operatorEmail,
          password: initialPassword
        }).toString(),
        redirect: 'manual'
      })
      expect(loginRes1.status).toBe(302)
      const code1 = new URL(loginRes1.headers.get('location')!).searchParams.get('code')!

      const sessionRes1 = await fetch(`${origin}/v1/desktop/auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code: code1,
          codeVerifier: verifier1,
          redirectUri: 'http://127.0.0.1:4000/auth/callback'
        })
      })
      const { accessToken: oldAccessToken } = (await sessionRes1.json()) as {
        accessToken: string
      }

      // 2. Issue Grant 1 (Relay token)
      const tokenRes1 = await fetch(`${origin}/v1/desktop/auth/relay-token`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${oldAccessToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          relayHostId,
          hostPublicKeyB64
        })
      })
      const { relayToken: oldRelayToken } = (await tokenRes1.json()) as { relayToken: string }

      // 3. Connect Control Client 1
      const assignRes1 = await fetch(`${origin}/v1/assign`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${oldRelayToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ v: 1, relayHostId })
      })
      const assign1 = (await assignRes1.json()) as { cellUrl: string; assignmentEpoch: number }

      let oldControlCloseCode: number | undefined
      oldControlClient = new RelayControlClient({
        cellUrl: assign1.cellUrl,
        relayJwt: oldRelayToken,
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
        silenceLimitMs,
        onClose: (code) => {
          oldControlCloseCode = code
        },
        onConnectionOpen: vi.fn(),
        onDrain: vi.fn()
      })
      await oldControlClient.connect()
      expect(oldControlClient.isLive()).toBe(true)

      // 4. Install device credential
      const installed = await oldControlClient.installCredential({
        reqId: 'req-install-mut-1',
        relayDeviceId: phoneDeviceId,
        newResumeTokenHash: resumeTokenHash,
        authorization: { mode: 'relay-basis', basisConnId: 'conn-1' }
      })
      expect(installed.currentVersion).toBe(1)

      // 5. Change password via Browser POST /v1/desktop/auth/password
      const pwdRes = await fetch(`${origin}/v1/desktop/auth/password`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          origin: 'http://127.0.0.1'
        },
        body: new URLSearchParams({
          email: operatorEmail,
          currentPassword: initialPassword,
          newPassword,
          confirmPassword: newPassword
        }).toString()
      })
      expect(pwdRes.status).toBe(200)

      // 6. Prove old session, grant, and control connection are invalidated
      const capOldRes = await fetch(`${origin}/v1/desktop/auth/capabilities`, {
        headers: { authorization: `Bearer ${oldAccessToken}` }
      })
      expect(capOldRes.status).toBe(401)

      const assignOldRes = await fetch(`${origin}/v1/assign`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${oldRelayToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ v: 1, relayHostId })
      })
      expect(assignOldRes.status).toBe(401)

      // Control socket should be closed by active revalidation / revocation
      await vi.waitFor(
        () => {
          expect(oldControlClient?.isLive()).toBe(false)
          expect(oldControlCloseCode).toBe(4401)
        },
        { timeout: 500 }
      )

      // 7. Sign in with NEW password
      const verifier2 = 'test-verifier-scenario2-new-12345678901234567890'
      const challenge2 = Buffer.from(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier2))
      ).toString('base64url')

      const authQuery2 = new URLSearchParams({
        client_id: clientId,
        redirect_uri: 'http://127.0.0.1:4000/auth/callback',
        code_challenge_method: 'S256',
        code_challenge: challenge2,
        response_type: 'code'
      }).toString()

      const loginRes2 = await fetch(`${origin}/v1/desktop/auth/authorize?${authQuery2}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          email: operatorEmail,
          password: newPassword
        }).toString(),
        redirect: 'manual'
      })
      expect(loginRes2.status).toBe(302)
      const code2 = new URL(loginRes2.headers.get('location')!).searchParams.get('code')!

      const sessionRes2 = await fetch(`${origin}/v1/desktop/auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code: code2,
          codeVerifier: verifier2,
          redirectUri: 'http://127.0.0.1:4000/auth/callback'
        })
      })
      const { accessToken: newAccessToken } = (await sessionRes2.json()) as {
        accessToken: string
      }

      // 8. Issue NEW Relay token
      const tokenRes2 = await fetch(`${origin}/v1/desktop/auth/relay-token`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${newAccessToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          relayHostId,
          hostPublicKeyB64
        })
      })
      const { relayToken: newRelayToken } = (await tokenRes2.json()) as { relayToken: string }

      // 9. Assign and connect NEW Control Client
      const assignRes2 = await fetch(`${origin}/v1/assign`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${newRelayToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ v: 1, relayHostId })
      })
      expect(assignRes2.status).toBe(200)
      const assign2 = (await assignRes2.json()) as { cellUrl: string; assignmentEpoch: number }

      newControlClient = new RelayControlClient({
        cellUrl: assign2.cellUrl,
        relayJwt: newRelayToken,
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
        silenceLimitMs,
        onClose: vi.fn(),
        onConnectionOpen: vi.fn(),
        onDrain: vi.fn()
      })
      await newControlClient.connect()
      expect(newControlClient.isLive()).toBe(true)

      // 10. Prove device credential was PRESERVED across password change (no re-pair)
      const status = await newControlClient.credentialInstallStatus(
        phoneDeviceId,
        'req-status-mut-1'
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

      // 11. Phone resumes with previous credential
      const phoneWsUrl = `${origin.replace('http://', 'ws://')}/v1/connect/${relayHostId}`
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
      oldControlClient?.closeNow()
      newControlClient?.closeNow()
      await serverInstance.close()
    }
  })

  it('Scenario 3: CLI reset has the same revocation/preservation behavior through real shared/bundle seam', async () => {
    const dbPath = createTempDbPath()
    const initialPassword = 'cli-initial-password-123!'
    const resetPassword = 'cli-brand-new-password-789!'
    const operatorEmail = 'cli-op@example.com'
    const operatorUserId = 'user-cli-1'
    const operatorProfileId = 'prof-cli-1'
    const operatorOrgId = 'org-cli-1'
    const clientId = 'orca-desktop'
    const silenceLimitMs = 60

    const env = {
      OWN_RELAY_STATE_PATH: dbPath,
      OWN_RELAY_ORIGIN: 'http://127.0.0.1',
      OWN_RELAY_AUTH_ORIGIN: 'http://127.0.0.1',
      OWN_RELAY_CLIENT_ID: clientId,
      OWN_RELAY_LISTEN_PORT: '0',
      OWN_RELAY_OPERATOR_EMAIL: operatorEmail,
      OWN_RELAY_OPERATOR_PASSWORD: initialPassword,
      OWN_RELAY_OPERATOR_USER_ID: operatorUserId,
      OWN_RELAY_OPERATOR_PROFILE_ID: operatorProfileId,
      OWN_RELAY_OPERATOR_ORG_ID: operatorOrgId
    }

    const config = parseOwnRelayServeConfig(env)
    const serverInstance = await startOwnRelayServer({
      config,
      silenceLimitMs,
      passwordPolicy: TEST_FAST_PASSWORD_POLICY
    })
    const origin = `http://127.0.0.1:${serverInstance.boundPort}`

    const hostKeypair = nacl.box.keyPair()
    const hostPublicKeyB64 = Buffer.from(hostKeypair.publicKey).toString('base64')
    const relayHostId = deriveRelayHostId(hostKeypair.publicKey)

    const rawResumeToken = generateRawResumeToken()
    const resumeTokenHash = sha256Base64Url(rawResumeToken)
    const phoneDeviceId = 'dev-phone-cli-1'

    let oldControlClient: RelayControlClient | undefined
    let newControlClient: RelayControlClient | undefined
    let phoneSocket: WebSocket | undefined

    try {
      // 1. Initial Login & Session 1
      const verifier1 = 'test-verifier-scenario3-initial-12345678901234567890'
      const challenge1 = Buffer.from(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier1))
      ).toString('base64url')

      const authQuery1 = new URLSearchParams({
        client_id: clientId,
        redirect_uri: 'http://127.0.0.1:4000/auth/callback',
        code_challenge_method: 'S256',
        code_challenge: challenge1,
        response_type: 'code'
      }).toString()

      const loginRes1 = await fetch(`${origin}/v1/desktop/auth/authorize?${authQuery1}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          email: operatorEmail,
          password: initialPassword
        }).toString(),
        redirect: 'manual'
      })
      expect(loginRes1.status).toBe(302)
      const code1 = new URL(loginRes1.headers.get('location')!).searchParams.get('code')!

      const sessionRes1 = await fetch(`${origin}/v1/desktop/auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code: code1,
          codeVerifier: verifier1,
          redirectUri: 'http://127.0.0.1:4000/auth/callback'
        })
      })
      const { accessToken: oldAccessToken } = (await sessionRes1.json()) as {
        accessToken: string
      }

      // 2. Issue Grant 1 (Relay token)
      const tokenRes1 = await fetch(`${origin}/v1/desktop/auth/relay-token`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${oldAccessToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          relayHostId,
          hostPublicKeyB64
        })
      })
      const { relayToken: oldRelayToken } = (await tokenRes1.json()) as { relayToken: string }

      // 3. Connect Control Client 1
      const assignRes1 = await fetch(`${origin}/v1/assign`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${oldRelayToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ v: 1, relayHostId })
      })
      const assign1 = (await assignRes1.json()) as { cellUrl: string; assignmentEpoch: number }

      let oldControlCloseCode: number | undefined
      oldControlClient = new RelayControlClient({
        cellUrl: assign1.cellUrl,
        relayJwt: oldRelayToken,
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
        silenceLimitMs,
        onClose: (code) => {
          oldControlCloseCode = code
        },
        onConnectionOpen: vi.fn(),
        onDrain: vi.fn()
      })
      await oldControlClient.connect()
      expect(oldControlClient.isLive()).toBe(true)

      // 4. Install device credential
      const installed = await oldControlClient.installCredential({
        reqId: 'req-install-cli-1',
        relayDeviceId: phoneDeviceId,
        newResumeTokenHash: resumeTokenHash,
        authorization: { mode: 'relay-basis', basisConnId: 'conn-1' }
      })
      expect(installed.currentVersion).toBe(1)

      // 5. Perform CLI reset-password through runAccountCli seam
      const mockPrompt: AccountCliPromptInterface = {
        isTTY: () => true,
        promptSecret: vi.fn(async () => resetPassword)
      }
      const cliResult = await runAccountCli({
        args: ['reset-password'],
        env: { OWN_RELAY_STATE_PATH: dbPath },
        prompt: mockPrompt,
        passwordPolicy: TEST_FAST_PASSWORD_POLICY
      })
      expect(cliResult.exitCode).toBe(0)
      expect(cliResult.stdout).toContain('Password reset successfully')

      // 6. Prove old session, grant, and control connection are invalidated
      const capOldRes = await fetch(`${origin}/v1/desktop/auth/capabilities`, {
        headers: { authorization: `Bearer ${oldAccessToken}` }
      })
      expect(capOldRes.status).toBe(401)

      const assignOldRes = await fetch(`${origin}/v1/assign`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${oldRelayToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ v: 1, relayHostId })
      })
      expect(assignOldRes.status).toBe(401)

      // Control socket should be closed by active revalidation / revocation
      await vi.waitFor(
        () => {
          expect(oldControlClient?.isLive()).toBe(false)
          expect(oldControlCloseCode).toBe(4401)
        },
        { timeout: 500 }
      )

      // 7. Sign in with NEW password
      const verifier2 = 'test-verifier-scenario3-new-12345678901234567890'
      const challenge2 = Buffer.from(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier2))
      ).toString('base64url')

      const authQuery2 = new URLSearchParams({
        client_id: clientId,
        redirect_uri: 'http://127.0.0.1:4000/auth/callback',
        code_challenge_method: 'S256',
        code_challenge: challenge2,
        response_type: 'code'
      }).toString()

      const loginRes2 = await fetch(`${origin}/v1/desktop/auth/authorize?${authQuery2}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          email: operatorEmail,
          password: resetPassword
        }).toString(),
        redirect: 'manual'
      })
      expect(loginRes2.status).toBe(302)
      const code2 = new URL(loginRes2.headers.get('location')!).searchParams.get('code')!

      const sessionRes2 = await fetch(`${origin}/v1/desktop/auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code: code2,
          codeVerifier: verifier2,
          redirectUri: 'http://127.0.0.1:4000/auth/callback'
        })
      })
      const { accessToken: newAccessToken } = (await sessionRes2.json()) as {
        accessToken: string
      }

      // 8. Issue NEW Relay token
      const tokenRes2 = await fetch(`${origin}/v1/desktop/auth/relay-token`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${newAccessToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          relayHostId,
          hostPublicKeyB64
        })
      })
      const { relayToken: newRelayToken } = (await tokenRes2.json()) as { relayToken: string }

      // 9. Assign and connect NEW Control Client
      const assignRes2 = await fetch(`${origin}/v1/assign`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${newRelayToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ v: 1, relayHostId })
      })
      expect(assignRes2.status).toBe(200)
      const assign2 = (await assignRes2.json()) as { cellUrl: string; assignmentEpoch: number }

      newControlClient = new RelayControlClient({
        cellUrl: assign2.cellUrl,
        relayJwt: newRelayToken,
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
        silenceLimitMs,
        onClose: vi.fn(),
        onConnectionOpen: vi.fn(),
        onDrain: vi.fn()
      })
      await newControlClient.connect()
      expect(newControlClient.isLive()).toBe(true)

      // 10. Prove device credential was PRESERVED across CLI reset (no re-pair)
      const status = await newControlClient.credentialInstallStatus(
        phoneDeviceId,
        'req-status-cli-1'
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

      // 11. Phone resumes with previous credential
      const phoneWsUrl = `${origin.replace('http://', 'ws://')}/v1/connect/${relayHostId}`
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
      oldControlClient?.closeNow()
      newControlClient?.closeNow()
      await serverInstance.close()
    }
  })
})
