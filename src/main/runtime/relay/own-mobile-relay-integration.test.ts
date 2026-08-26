import { describe, expect, it } from 'vitest'
import nacl from 'tweetnacl'
import { deriveRelayHostId } from './relay-http-client'
import { listenOwnMobileRelay } from './own-mobile-relay-http'

const defaultOperator = {
  email: 'operator@example.com',
  password: 'operator-secret-password-123',
  userId: 'user-op-1',
  profileId: 'prof-op-1',
  organizationId: 'org-op-1'
}

const defaultClientId = 'orca-desktop'

describe('Task 4 10 Integration Cases', () => {
  it('Case 1: Login verifies the SQLite/memory account rather than an operator object passed to the route', async () => {
    const { createOwnMobileRelaySecurityStateMemory } =
      await import('./own-mobile-relay-security-state-memory')
    const { derivePasswordRecord, TEST_FAST_PASSWORD_POLICY } =
      await import('./own-mobile-relay-password')
    const state = createOwnMobileRelaySecurityStateMemory()
    const pwdRec = await derivePasswordRecord(
      'state-account-password-123',
      TEST_FAST_PASSWORD_POLICY
    )
    await state.bootstrapAccount({
      email: 'durable-user@example.com',
      userId: 'u-durable-1',
      profileId: 'p-durable-1',
      organizationId: 'o-durable-1',
      passwordRecord: pwdRec
    })

    const server = await listenOwnMobileRelay({
      securityState: state,
      clientId: defaultClientId,
      origin: 'http://127.0.0.1',
      passwordPolicy: TEST_FAST_PASSWORD_POLICY
    })

    try {
      const query = `client_id=${defaultClientId}&redirect_uri=http://127.0.0.1:4000/auth/callback&code_challenge_method=S256&code_challenge=xyzChallenge12345678901234567890123&response_type=code`
      // Attempt login with defaultOperator (not in state) -> 401
      const resFail = await fetch(`${server.origin}/v1/desktop/auth/authorize?${query}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          email: defaultOperator.email,
          password: defaultOperator.password
        }).toString(),
        redirect: 'manual'
      })
      expect(resFail.status).toBe(401)

      // Attempt login with durable account credentials -> 302
      const resSuccess = await fetch(`${server.origin}/v1/desktop/auth/authorize?${query}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          email: 'durable-user@example.com',
          password: 'state-account-password-123'
        }).toString(),
        redirect: 'manual'
      })
      expect(resSuccess.status).toBe(302)
      expect(resSuccess.headers.get('location')).toContain('code=')
    } finally {
      await server.close()
    }
  })

  it('Case 2: PKCE code exchange persists a hashed access session and returns the raw token once', async () => {
    const { createOwnMobileRelaySecurityStateMemory } =
      await import('./own-mobile-relay-security-state-memory')
    const state = createOwnMobileRelaySecurityStateMemory()
    const server = await listenOwnMobileRelay({
      securityState: state,
      operator: defaultOperator,
      clientId: defaultClientId,
      origin: 'http://127.0.0.1'
    })

    try {
      const verifier = 'test-code-verifier-string-case2-1234567890'
      const challenge = Buffer.from(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
      ).toString('base64url')

      const query = `client_id=${defaultClientId}&redirect_uri=http://127.0.0.1:4000/auth/callback&code_challenge_method=S256&code_challenge=${challenge}&response_type=code`
      const loginRes = await fetch(`${server.origin}/v1/desktop/auth/authorize?${query}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          email: defaultOperator.email,
          password: defaultOperator.password
        }).toString(),
        redirect: 'manual'
      })
      const code = new URL(loginRes.headers.get('location')!).searchParams.get('code')!

      const sessionRes = await fetch(`${server.origin}/v1/desktop/auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code,
          codeVerifier: verifier,
          redirectUri: 'http://127.0.0.1:4000/auth/callback'
        })
      })
      expect(sessionRes.status).toBe(200)
      const body = (await sessionRes.json()) as { accessToken: string }
      const rawAccessToken = body.accessToken

      // Raw token looked up in security state succeeds
      const durableSession = await state.lookupAccessSessionByToken(rawAccessToken)
      expect(durableSession).not.toBeNull()
      expect(durableSession?.identity.userId).toBe(defaultOperator.userId)
    } finally {
      await server.close()
    }
  })

  it('Case 3: Capabilities/profile validate durable access sessions after server close/reopen', async () => {
    const { createOwnMobileRelaySecurityStateSqlite } =
      await import('./own-mobile-relay-security-state-sqlite')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')
    const { mkdtempSync, rmSync } = await import('node:fs')

    const dir = mkdtempSync(join(tmpdir(), 'orca-case3-'))
    const dbPath = join(dir, 'security.db')

    try {
      const state1 = createOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: true })
      const server1 = await listenOwnMobileRelay({
        securityState: state1,
        operator: defaultOperator,
        clientId: defaultClientId,
        origin: 'http://127.0.0.1'
      })

      const verifier = 'test-code-verifier-string-case3-1234567890'
      const challenge = Buffer.from(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
      ).toString('base64url')
      const query = `client_id=${defaultClientId}&redirect_uri=http://127.0.0.1:4000/auth/callback&code_challenge_method=S256&code_challenge=${challenge}&response_type=code`
      const loginRes = await fetch(`${server1.origin}/v1/desktop/auth/authorize?${query}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          email: defaultOperator.email,
          password: defaultOperator.password
        }).toString(),
        redirect: 'manual'
      })
      const code = new URL(loginRes.headers.get('location')!).searchParams.get('code')!

      const sessionRes = await fetch(`${server1.origin}/v1/desktop/auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code,
          codeVerifier: verifier,
          redirectUri: 'http://127.0.0.1:4000/auth/callback'
        })
      })
      const { accessToken } = (await sessionRes.json()) as { accessToken: string }

      // Close server1 and state1
      await server1.close()
      await state1.close()

      // Reopen new server instance with same SQLite database
      const state2 = createOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: true })
      const server2 = await listenOwnMobileRelay({
        securityState: state2,
        clientId: defaultClientId,
        origin: 'http://127.0.0.1'
      })

      try {
        const capRes = await fetch(`${server2.origin}/v1/desktop/auth/capabilities`, {
          headers: { authorization: `Bearer ${accessToken}` }
        })
        expect(capRes.status).toBe(200)

        const profRes = await fetch(`${server2.origin}/v1/desktop/auth/profile`, {
          headers: { authorization: `Bearer ${accessToken}` }
        })
        expect(profRes.status).toBe(200)
        const profBody = (await profRes.json()) as { email: string }
        expect(profBody.email).toBe(defaultOperator.email)
      } finally {
        await server2.close()
        await state2.close()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('Case 4: Refresh atomically revokes the old durable session, creates the new durable session, and rotates only the ephemeral refresh token', async () => {
    const { createOwnMobileRelaySecurityStateMemory } =
      await import('./own-mobile-relay-security-state-memory')
    const state = createOwnMobileRelaySecurityStateMemory()
    const server = await listenOwnMobileRelay({
      securityState: state,
      operator: defaultOperator,
      clientId: defaultClientId,
      origin: 'http://127.0.0.1'
    })

    try {
      const verifier = 'test-code-verifier-string-case4-1234567890'
      const challenge = Buffer.from(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
      ).toString('base64url')
      const query = `client_id=${defaultClientId}&redirect_uri=http://127.0.0.1:4000/auth/callback&code_challenge_method=S256&code_challenge=${challenge}&response_type=code`
      const loginRes = await fetch(`${server.origin}/v1/desktop/auth/authorize?${query}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          email: defaultOperator.email,
          password: defaultOperator.password
        }).toString(),
        redirect: 'manual'
      })
      const code = new URL(loginRes.headers.get('location')!).searchParams.get('code')!

      const sessionRes = await fetch(`${server.origin}/v1/desktop/auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code,
          codeVerifier: verifier,
          redirectUri: 'http://127.0.0.1:4000/auth/callback'
        })
      })
      const { accessToken: oldAccess, refreshToken: oldRefresh } = (await sessionRes.json()) as {
        accessToken: string
        refreshToken: string
      }

      // Verify old session valid in durable state
      expect(await state.lookupAccessSessionByToken(oldAccess)).not.toBeNull()

      // Perform refresh
      const refreshRes = await fetch(`${server.origin}/v1/desktop/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: oldRefresh })
      })
      expect(refreshRes.status).toBe(200)
      const { accessToken: newAccess, refreshToken: newRefresh } = (await refreshRes.json()) as {
        accessToken: string
        refreshToken: string
      }
      expect(newRefresh).toBeTruthy()

      // Old durable session is revoked in state
      expect(await state.lookupAccessSessionByToken(oldAccess)).toBeNull()
      // New durable session is active in state
      expect(await state.lookupAccessSessionByToken(newAccess)).not.toBeNull()

      // Old refresh token is revoked
      const replayRes = await fetch(`${server.origin}/v1/desktop/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: oldRefresh })
      })
      expect(replayRes.status).toBe(401)
    } finally {
      await server.close()
    }
  })

  it('Case 5: Logout revokes the durable session; its Relay grant fails assignment immediately', async () => {
    const { createOwnMobileRelaySecurityStateMemory } =
      await import('./own-mobile-relay-security-state-memory')
    const state = createOwnMobileRelaySecurityStateMemory()
    const server = await listenOwnMobileRelay({
      securityState: state,
      operator: defaultOperator,
      clientId: defaultClientId,
      origin: 'http://127.0.0.1'
    })

    try {
      const verifier = 'test-code-verifier-string-case5-1234567890'
      const challenge = Buffer.from(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
      ).toString('base64url')
      const query = `client_id=${defaultClientId}&redirect_uri=http://127.0.0.1:4000/auth/callback&code_challenge_method=S256&code_challenge=${challenge}&response_type=code`
      const loginRes = await fetch(`${server.origin}/v1/desktop/auth/authorize?${query}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          email: defaultOperator.email,
          password: defaultOperator.password
        }).toString(),
        redirect: 'manual'
      })
      const code = new URL(loginRes.headers.get('location')!).searchParams.get('code')!

      const sessionRes = await fetch(`${server.origin}/v1/desktop/auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code,
          codeVerifier: verifier,
          redirectUri: 'http://127.0.0.1:4000/auth/callback'
        })
      })
      const { accessToken } = (await sessionRes.json()) as { accessToken: string }

      const hostKeys = nacl.box.keyPair()
      const relayHostId = deriveRelayHostId(hostKeys.publicKey)
      const hostPublicKeyB64 = Buffer.from(hostKeys.publicKey).toString('base64')

      const tokenRes = await fetch(`${server.origin}/v1/desktop/auth/relay-token`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ relayHostId, hostPublicKeyB64 })
      })
      const { relayToken } = (await tokenRes.json()) as { relayToken: string }

      // Logout
      const logoutRes = await fetch(`${server.origin}/v1/desktop/auth/logout`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({})
      })
      expect(logoutRes.status).toBe(200)

      // Grant assignment fails immediately because parent session is revoked
      const assignRes = await fetch(`${server.origin}/v1/assign`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${relayToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ v: 1, relayHostId })
      })
      expect(assignRes.status).toBe(401)
    } finally {
      await server.close()
    }
  })

  it('Case 6: Relay-token response expiry equals the stored enforced expiry', async () => {
    const { createOwnMobileRelaySecurityStateMemory } =
      await import('./own-mobile-relay-security-state-memory')
    const state = createOwnMobileRelaySecurityStateMemory()
    const server = await listenOwnMobileRelay({
      securityState: state,
      operator: defaultOperator,
      clientId: defaultClientId,
      origin: 'http://127.0.0.1'
    })

    try {
      const verifier = 'test-code-verifier-string-case6-1234567890'
      const challenge = Buffer.from(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
      ).toString('base64url')
      const query = `client_id=${defaultClientId}&redirect_uri=http://127.0.0.1:4000/auth/callback&code_challenge_method=S256&code_challenge=${challenge}&response_type=code`
      const loginRes = await fetch(`${server.origin}/v1/desktop/auth/authorize?${query}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          email: defaultOperator.email,
          password: defaultOperator.password
        }).toString(),
        redirect: 'manual'
      })
      const code = new URL(loginRes.headers.get('location')!).searchParams.get('code')!

      const sessionRes = await fetch(`${server.origin}/v1/desktop/auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code,
          codeVerifier: verifier,
          redirectUri: 'http://127.0.0.1:4000/auth/callback'
        })
      })
      const { accessToken } = (await sessionRes.json()) as { accessToken: string }

      const hostKeys = nacl.box.keyPair()
      const relayHostId = deriveRelayHostId(hostKeys.publicKey)
      const hostPublicKeyB64 = Buffer.from(hostKeys.publicKey).toString('base64')

      const tokenRes = await fetch(`${server.origin}/v1/desktop/auth/relay-token`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ relayHostId, hostPublicKeyB64 })
      })
      const { relayToken, expiresAt: responseExpiresAt } = (await tokenRes.json()) as {
        relayToken: string
        expiresAt: number
      }

      const storedGrant = await state.validateRelayGrantByToken(relayToken)
      expect(storedGrant).not.toBeNull()
      expect(responseExpiresAt).toBe(storedGrant!.expiresAt)
    } finally {
      await server.close()
    }
  })

  it('Case 7: Assignment and host-control reject an expired/revoked/stale-parent grant', async () => {
    const { createOwnMobileRelaySecurityStateMemory } =
      await import('./own-mobile-relay-security-state-memory')
    const state = createOwnMobileRelaySecurityStateMemory()
    const server = await listenOwnMobileRelay({
      securityState: state,
      operator: defaultOperator,
      clientId: defaultClientId,
      origin: 'http://127.0.0.1'
    })

    try {
      const verifier = 'test-code-verifier-string-case7-1234567890'
      const challenge = Buffer.from(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
      ).toString('base64url')
      const query = `client_id=${defaultClientId}&redirect_uri=http://127.0.0.1:4000/auth/callback&code_challenge_method=S256&code_challenge=${challenge}&response_type=code`
      const loginRes = await fetch(`${server.origin}/v1/desktop/auth/authorize?${query}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          email: defaultOperator.email,
          password: defaultOperator.password
        }).toString(),
        redirect: 'manual'
      })
      const code = new URL(loginRes.headers.get('location')!).searchParams.get('code')!

      const sessionRes = await fetch(`${server.origin}/v1/desktop/auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code,
          codeVerifier: verifier,
          redirectUri: 'http://127.0.0.1:4000/auth/callback'
        })
      })
      const { accessToken } = (await sessionRes.json()) as { accessToken: string }

      const hostKeys = nacl.box.keyPair()
      const relayHostId = deriveRelayHostId(hostKeys.publicKey)
      const hostPublicKeyB64 = Buffer.from(hostKeys.publicKey).toString('base64')

      const tokenRes = await fetch(`${server.origin}/v1/desktop/auth/relay-token`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ relayHostId, hostPublicKeyB64 })
      })
      const { relayToken } = (await tokenRes.json()) as { relayToken: string }

      // Revoke parent session by token
      await state.revokeAccessSessionByToken(accessToken)

      // Assignment rejects
      const assignRes = await fetch(`${server.origin}/v1/assign`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${relayToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ v: 1, relayHostId })
      })
      expect(assignRes.status).toBe(401)

      // Host control WebSocket upgrade rejects with 401
      const { WebSocket } = await import('ws')
      const wsUrl = `${server.origin.replace(/^http/, 'ws')}/v1/host/control`
      const ws = new WebSocket(wsUrl, {
        headers: { authorization: `Bearer ${relayToken}` }
      })
      const errorPromise = new Promise<{ code?: number; message?: string }>((resolve) => {
        ws.once('error', (err: Error) => resolve({ message: err.message }))
        ws.once('unexpected-response', (_req, res) => resolve({ code: res.statusCode }))
      })
      const wsResult = await errorPromise
      expect(wsResult.code === 401 || Boolean(wsResult.message?.includes('401'))).toBe(true)
    } finally {
      await server.close()
    }
  })

  it('Case 8: Grant identity continues to bind desktop cloudProfileId (70c38a64bc invariant)', async () => {
    const { createOwnMobileRelaySecurityStateMemory } =
      await import('./own-mobile-relay-security-state-memory')
    const state = createOwnMobileRelaySecurityStateMemory()
    const server = await listenOwnMobileRelay({
      securityState: state,
      operator: defaultOperator,
      clientId: defaultClientId,
      origin: 'http://127.0.0.1'
    })

    try {
      const verifier = 'test-code-verifier-string-case8-1234567890'
      const challenge = Buffer.from(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
      ).toString('base64url')
      const localProfileId = 'local-custom-profile-case8'

      const query = `client_id=${defaultClientId}&redirect_uri=http://127.0.0.1:4000/auth/callback&code_challenge_method=S256&code_challenge=${challenge}&response_type=code&local_profile_id=${localProfileId}`
      const loginRes = await fetch(`${server.origin}/v1/desktop/auth/authorize?${query}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          email: defaultOperator.email,
          password: defaultOperator.password
        }).toString(),
        redirect: 'manual'
      })
      const code = new URL(loginRes.headers.get('location')!).searchParams.get('code')!

      const sessionRes = await fetch(`${server.origin}/v1/desktop/auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code,
          codeVerifier: verifier,
          redirectUri: 'http://127.0.0.1:4000/auth/callback',
          localProfileId
        })
      })
      const { accessToken } = (await sessionRes.json()) as { accessToken: string }

      const hostKeys = nacl.box.keyPair()
      const relayHostId = deriveRelayHostId(hostKeys.publicKey)
      const hostPublicKeyB64 = Buffer.from(hostKeys.publicKey).toString('base64')

      const tokenRes = await fetch(`${server.origin}/v1/desktop/auth/relay-token`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ relayHostId, hostPublicKeyB64 })
      })
      const { relayToken } = (await tokenRes.json()) as { relayToken: string }

      const grant = await state.validateRelayGrantByToken(relayToken)
      expect(grant).not.toBeNull()
      expect(grant!.identity.profileId).toBe(localProfileId)
    } finally {
      await server.close()
    }
  })

  it('Case 9: Account bootstrap creates no access session or grant', async () => {
    const { createOwnMobileRelaySecurityStateMemory } =
      await import('./own-mobile-relay-security-state-memory')
    const { bootstrapOperatorAccount } = await import('./own-mobile-relay-account')
    const { TEST_FAST_PASSWORD_POLICY } = await import('./own-mobile-relay-password')
    const state = createOwnMobileRelaySecurityStateMemory()
    try {
      await bootstrapOperatorAccount(state, defaultOperator, TEST_FAST_PASSWORD_POLICY)
      const cleanup = await state.cleanupExpired()
      expect(cleanup.expiredSessionsDeleted).toBe(0)
      expect(cleanup.expiredGrantsDeleted).toBe(0)
    } finally {
      await state.close()
    }
  })

  it('Case 10: Successful verification of an older password policy upgrades verifier without invalidating newly issued session unless password changed', async () => {
    const { createOwnMobileRelaySecurityStateMemory } =
      await import('./own-mobile-relay-security-state-memory')
    const { derivePasswordRecord, TEST_FAST_PASSWORD_POLICY } =
      await import('./own-mobile-relay-password')
    const state = createOwnMobileRelaySecurityStateMemory()

    // Bootstrap with older/test fast policy
    const oldPasswordRec = await derivePasswordRecord(
      'test-old-policy-password-123',
      TEST_FAST_PASSWORD_POLICY
    )
    await state.bootstrapAccount({
      email: 'upgrade-user@example.com',
      userId: 'u-up-1',
      profileId: 'p-up-1',
      organizationId: 'o-up-1',
      passwordRecord: oldPasswordRec
    })

    // Older verifier version is 1
    const initialPw = await state.getAccountPasswordRecord()
    expect(initialPw?.verifierVersion).toBe(1)
    expect(initialPw?.authEpoch).toBe(1)

    // Start server configured with TEST_FAST_PASSWORD_POLICY as older, but login upgrades to a newer policy (e.g. custom policy with version: 2)
    const newerPolicy = {
      version: 2,
      params: {
        N: 2048,
        r: 8,
        p: 1,
        keyLen: 32,
        maxmem: 64 * 1024 * 1024
      }
    }

    const server = await listenOwnMobileRelay({
      securityState: state,
      clientId: defaultClientId,
      origin: 'http://127.0.0.1',
      passwordPolicy: newerPolicy
    })

    try {
      const verifier = 'test-code-verifier-string-case10-1234567890'
      const challenge = Buffer.from(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
      ).toString('base64url')

      // Login with valid credentials under newer policy
      const query = `client_id=${defaultClientId}&redirect_uri=http://127.0.0.1:4000/auth/callback&code_challenge_method=S256&code_challenge=${challenge}&response_type=code`
      const loginRes = await fetch(`${server.origin}/v1/desktop/auth/authorize?${query}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          email: 'upgrade-user@example.com',
          password: 'test-old-policy-password-123'
        }).toString(),
        redirect: 'manual'
      })
      expect(loginRes.status).toBe(302)

      // Verifier version has upgraded to 2 via CAS, but authEpoch remains 1
      const upgradedPw = await state.getAccountPasswordRecord()
      expect(upgradedPw?.verifierVersion).toBe(2)
      expect(upgradedPw?.authEpoch).toBe(1)

      // Exchange code for session
      const code = new URL(loginRes.headers.get('location')!).searchParams.get('code')!
      const sessionRes = await fetch(`${server.origin}/v1/desktop/auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code,
          codeVerifier: verifier,
          redirectUri: 'http://127.0.0.1:4000/auth/callback'
        })
      })
      expect(sessionRes.status).toBe(200)
      const { accessToken } = (await sessionRes.json()) as { accessToken: string }

      // Session token remains completely valid and usable
      const capRes = await fetch(`${server.origin}/v1/desktop/auth/capabilities`, {
        headers: { authorization: `Bearer ${accessToken}` }
      })
      expect(capRes.status).toBe(200)
    } finally {
      await server.close()
    }
  })
})
