import { describe, expect, it, vi } from 'vitest'
import nacl from 'tweetnacl'
import { deriveRelayHostId } from './relay-http-client'
import { listenOwnMobileRelay } from './own-mobile-relay-http'
import { RelayControlClient } from './relay-control-client'
import type { E2EEKeypair } from '../e2ee-keypair'

const defaultOperator = {
  email: 'operator@example.com',
  password: 'operator-secret-password-123',
  userId: 'user-op-1',
  profileId: 'prof-op-1',
  organizationId: 'org-op-1'
}

const defaultClientId = 'orca-desktop'

describe('own mobile relay auth (PKCE own-auth)', () => {
  describe('GET /v1/desktop/auth/authorize', () => {
    it('rejects invalid client_id, non-loopback redirect_uri, and missing/invalid S256 challenge', async () => {
      const server = await listenOwnMobileRelay({
        operator: defaultOperator,
        clientId: defaultClientId,
        origin: 'http://127.0.0.1'
      })
      try {
        // Wrong client_id
        const res1 = await fetch(
          `${server.origin}/v1/desktop/auth/authorize?client_id=wrong&redirect_uri=http://127.0.0.1:4000/auth/callback&code_challenge_method=S256&code_challenge=abc&response_type=code`
        )
        expect(res1.status).toBe(400)

        // Non-loopback redirect_uri
        const res2 = await fetch(
          `${server.origin}/v1/desktop/auth/authorize?client_id=${defaultClientId}&redirect_uri=https://evil.com/auth/callback&code_challenge_method=S256&code_challenge=abc&response_type=code`
        )
        expect(res2.status).toBe(400)

        // Missing code_challenge_method
        const res3 = await fetch(
          `${server.origin}/v1/desktop/auth/authorize?client_id=${defaultClientId}&redirect_uri=http://127.0.0.1:4000/auth/callback&code_challenge=abc&response_type=code`
        )
        expect(res3.status).toBe(400)

        // Plain code_challenge_method (must be S256)
        const res4 = await fetch(
          `${server.origin}/v1/desktop/auth/authorize?client_id=${defaultClientId}&redirect_uri=http://127.0.0.1:4000/auth/callback&code_challenge_method=plain&code_challenge=abc&response_type=code`
        )
        expect(res4.status).toBe(400)

        // Missing code_challenge
        const res5 = await fetch(
          `${server.origin}/v1/desktop/auth/authorize?client_id=${defaultClientId}&redirect_uri=http://127.0.0.1:4000/auth/callback&code_challenge_method=S256&response_type=code`
        )
        expect(res5.status).toBe(400)
      } finally {
        await server.close()
      }
    })

    it('returns 200 HTML login form with valid parameters', async () => {
      const server = await listenOwnMobileRelay({
        operator: defaultOperator,
        clientId: defaultClientId,
        origin: 'http://127.0.0.1'
      })
      try {
        const res = await fetch(
          `${server.origin}/v1/desktop/auth/authorize?client_id=${defaultClientId}&redirect_uri=http://127.0.0.1:4000/auth/callback&code_challenge_method=S256&code_challenge=abc123challenge&response_type=code&state=xyzState&nonce=xyzNonce`
        )
        expect(res.status).toBe(200)
        expect(res.headers.get('content-type')).toContain('text/html')
        const html = await res.text()
        expect(html).toContain('type="password"')
        expect(html).toContain('name="password"')
        expect(html).toContain('name="email"')
      } finally {
        await server.close()
      }
    })
  })

  describe('POST /v1/desktop/auth/authorize (login submission)', () => {
    it('rejects wrong credentials with 401', async () => {
      const server = await listenOwnMobileRelay({
        operator: defaultOperator,
        clientId: defaultClientId,
        origin: 'http://127.0.0.1'
      })
      try {
        const query = `client_id=${defaultClientId}&redirect_uri=http://127.0.0.1:4000/auth/callback&code_challenge_method=S256&code_challenge=abc123challenge&response_type=code&state=xyzState`
        const body = new URLSearchParams({
          email: defaultOperator.email,
          password: 'wrong-password'
        })
        const res = await fetch(`${server.origin}/v1/desktop/auth/authorize?${query}`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
          redirect: 'manual'
        })
        expect(res.status).toBe(401)
      } finally {
        await server.close()
      }
    })

    it('issues an authorization code and responds 302 to redirect_uri on valid credentials', async () => {
      const server = await listenOwnMobileRelay({
        operator: defaultOperator,
        clientId: defaultClientId,
        origin: 'http://127.0.0.1'
      })
      try {
        const query = `client_id=${defaultClientId}&redirect_uri=http://127.0.0.1:4000/auth/callback&code_challenge_method=S256&code_challenge=abc123challenge&response_type=code&state=xyzState&nonce=xyzNonce`
        const body = new URLSearchParams({
          email: defaultOperator.email,
          password: defaultOperator.password
        })
        const res = await fetch(`${server.origin}/v1/desktop/auth/authorize?${query}`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
          redirect: 'manual'
        })
        expect(res.status).toBe(302)
        const location = res.headers.get('location')
        expect(location).toBeTruthy()
        const redirectUrl = new URL(location!)
        expect(redirectUrl.origin).toBe('http://127.0.0.1:4000')
        expect(redirectUrl.pathname).toBe('/auth/callback')
        expect(redirectUrl.searchParams.get('state')).toBe('xyzState')
        const code = redirectUrl.searchParams.get('code')
        expect(code).toBeTruthy()
        expect(code!.length).toBeGreaterThan(16)
      } finally {
        await server.close()
      }
    })
  })

  describe('POST /v1/desktop/auth/session (session exchange)', () => {
    it('rejects unknown code, wrong code verifier, and code replay', async () => {
      const server = await listenOwnMobileRelay({
        operator: defaultOperator,
        clientId: defaultClientId,
        origin: 'http://127.0.0.1'
      })
      try {
        const verifier = 'test-code-verifier-string-12345678901234567890'
        const challenge = Buffer.from(
          await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
        ).toString('base64url')

        // 1. Unknown code
        const resUnknown = await fetch(`${server.origin}/v1/desktop/auth/session`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            code: 'nonexistent-code',
            codeVerifier: verifier,
            nonce: 'n1',
            redirectUri: 'http://127.0.0.1:4000/auth/callback',
            state: 's1',
            localProfileId: 'local-default'
          })
        })
        expect(resUnknown.status).toBe(400)

        // Obtain real code
        const query = `client_id=${defaultClientId}&redirect_uri=http://127.0.0.1:4000/auth/callback&code_challenge_method=S256&code_challenge=${challenge}&response_type=code&state=s1&nonce=n1`
        const loginRes = await fetch(`${server.origin}/v1/desktop/auth/authorize?${query}`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            email: defaultOperator.email,
            password: defaultOperator.password
          }).toString(),
          redirect: 'manual'
        })
        const location = new URL(loginRes.headers.get('location')!)
        const code = location.searchParams.get('code')!

        // 2. Wrong code verifier
        const resWrongVerifier = await fetch(`${server.origin}/v1/desktop/auth/session`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            code,
            codeVerifier: 'wrong-verifier',
            nonce: 'n1',
            redirectUri: 'http://127.0.0.1:4000/auth/callback',
            state: 's1',
            localProfileId: 'local-default'
          })
        })
        expect(resWrongVerifier.status).toBe(401)

        // 3. Replay with the code (it failed / was invalidated)
        const resReplay = await fetch(`${server.origin}/v1/desktop/auth/session`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            code,
            codeVerifier: verifier,
            nonce: 'n1',
            redirectUri: 'http://127.0.0.1:4000/auth/callback',
            state: 's1',
            localProfileId: 'local-default'
          })
        })
        expect(resReplay.status).toBeGreaterThanOrEqual(400)
      } finally {
        await server.close()
      }
    })

    it('successfully exchanges valid code for session with relay.use capability flag', async () => {
      const server = await listenOwnMobileRelay({
        operator: defaultOperator,
        clientId: defaultClientId,
        origin: 'http://127.0.0.1'
      })
      try {
        const verifier = 'valid-code-verifier-string-12345678901234567890'
        const challenge = Buffer.from(
          await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
        ).toString('base64url')

        const query = `client_id=${defaultClientId}&redirect_uri=http://127.0.0.1:4000/auth/callback&code_challenge_method=S256&code_challenge=${challenge}&response_type=code&state=s1&nonce=n1&local_profile_id=local-default`
        const loginRes = await fetch(`${server.origin}/v1/desktop/auth/authorize?${query}`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            email: defaultOperator.email,
            password: defaultOperator.password
          }).toString(),
          redirect: 'manual'
        })
        const location = new URL(loginRes.headers.get('location')!)
        const code = location.searchParams.get('code')!

        const sessionRes = await fetch(`${server.origin}/v1/desktop/auth/session`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            code,
            codeVerifier: verifier,
            nonce: 'n1',
            redirectUri: 'http://127.0.0.1:4000/auth/callback',
            state: 's1',
            localProfileId: 'local-default'
          })
        })
        expect(sessionRes.status).toBe(200)
        const session = (await sessionRes.json()) as {
          accessToken: string
          refreshToken: string
          expiresAt: number
          cloud: unknown
          organizations: unknown
          capabilities: unknown
        }
        expect(session.accessToken).toBeTruthy()
        expect(session.refreshToken).toBeTruthy()
        expect(session.expiresAt).toBeGreaterThan(Date.now())
        expect(session.cloud).toEqual({
          cloudProfileId: expect.any(String),
          userId: defaultOperator.userId,
          email: defaultOperator.email,
          displayName: undefined,
          activeOrgId: defaultOperator.organizationId,
          activeOrgName: undefined,
          linkedAt: expect.any(Number)
        })
        expect(session.organizations).toEqual([
          {
            orgId: defaultOperator.organizationId,
            name: 'Personal',
            role: 'owner'
          }
        ])
        expect(session.capabilities).toEqual({
          flags: { 'relay.use': true },
          refreshedAt: expect.any(Number)
        })

        // Replay of used code must fail
        const replayRes = await fetch(`${server.origin}/v1/desktop/auth/session`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            code,
            codeVerifier: verifier,
            nonce: 'n1',
            redirectUri: 'http://127.0.0.1:4000/auth/callback',
            state: 's1',
            localProfileId: 'local-default'
          })
        })
        expect(replayRes.status).toBeGreaterThanOrEqual(400)
      } finally {
        await server.close()
      }
    })
  })

  describe('refresh, capabilities, profile, logout endpoints', () => {
    async function obtainSession(serverOrigin: string) {
      const verifier = 'valid-code-verifier-string-12345678901234567890'
      const challenge = Buffer.from(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
      ).toString('base64url')

      const query = `client_id=${defaultClientId}&redirect_uri=http://127.0.0.1:4000/auth/callback&code_challenge_method=S256&code_challenge=${challenge}&response_type=code&state=s1&nonce=n1&local_profile_id=local-default`
      const loginRes = await fetch(`${serverOrigin}/v1/desktop/auth/authorize?${query}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          email: defaultOperator.email,
          password: defaultOperator.password
        }).toString(),
        redirect: 'manual'
      })
      const location = new URL(loginRes.headers.get('location')!)
      const code = location.searchParams.get('code')!

      const sessionRes = await fetch(`${serverOrigin}/v1/desktop/auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code,
          codeVerifier: verifier,
          nonce: 'n1',
          redirectUri: 'http://127.0.0.1:4000/auth/callback',
          state: 's1',
          localProfileId: 'local-default'
        })
      })
      return (await sessionRes.json()) as {
        accessToken: string
        refreshToken: string
        expiresAt: number
        cloud: unknown
        organizations: unknown
        capabilities: unknown
      }
    }

    it('rotates session tokens on POST /v1/desktop/auth/refresh and invalidates old refresh token', async () => {
      const server = await listenOwnMobileRelay({
        operator: defaultOperator,
        clientId: defaultClientId,
        origin: 'http://127.0.0.1'
      })
      try {
        const initialSession = await obtainSession(server.origin)

        const refreshRes = await fetch(`${server.origin}/v1/desktop/auth/refresh`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ refreshToken: initialSession.refreshToken })
        })
        expect(refreshRes.status).toBe(200)
        const refreshed = (await refreshRes.json()) as {
          accessToken: string
          refreshToken: string
          expiresAt: number
          capabilities: unknown
        }
        expect(refreshed.accessToken).toBeTruthy()
        expect(refreshed.refreshToken).toBeTruthy()
        expect(refreshed.accessToken).not.toBe(initialSession.accessToken)
        expect(refreshed.refreshToken).not.toBe(initialSession.refreshToken)
        expect(refreshed.capabilities).toEqual({
          flags: { 'relay.use': true },
          refreshedAt: expect.any(Number)
        })

        // Old refresh token must now fail
        const oldRefreshRes = await fetch(`${server.origin}/v1/desktop/auth/refresh`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ refreshToken: initialSession.refreshToken })
        })
        expect(oldRefreshRes.status).toBe(401)
      } finally {
        await server.close()
      }
    })

    it('returns capabilities on GET and POST /v1/desktop/auth/capabilities with Bearer token, rejects without', async () => {
      const server = await listenOwnMobileRelay({
        operator: defaultOperator,
        clientId: defaultClientId,
        origin: 'http://127.0.0.1'
      })
      try {
        const session = await obtainSession(server.origin)

        // Without Bearer -> 401
        const noAuthGet = await fetch(`${server.origin}/v1/desktop/auth/capabilities`)
        expect(noAuthGet.status).toBe(401)
        const noAuthPost = await fetch(`${server.origin}/v1/desktop/auth/capabilities`, {
          method: 'POST'
        })
        expect(noAuthPost.status).toBe(401)

        // With Bearer GET -> 200
        const getRes = await fetch(`${server.origin}/v1/desktop/auth/capabilities`, {
          headers: { authorization: `Bearer ${session.accessToken}` }
        })
        expect(getRes.status).toBe(200)
        const getBody = (await getRes.json()) as { capabilities: unknown }
        expect(getBody.capabilities).toEqual({
          flags: { 'relay.use': true },
          refreshedAt: expect.any(Number)
        })

        // With Bearer POST -> 200
        const postRes = await fetch(`${server.origin}/v1/desktop/auth/capabilities`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${session.accessToken}`,
            'content-type': 'application/json'
          },
          body: JSON.stringify({})
        })
        expect(postRes.status).toBe(200)
        const postBody = (await postRes.json()) as { capabilities: unknown }
        expect(postBody.capabilities).toEqual({
          flags: { 'relay.use': true },
          refreshedAt: expect.any(Number)
        })
      } finally {
        await server.close()
      }
    })

    it('returns profile on GET /v1/desktop/auth/profile with Bearer token, rejects without', async () => {
      const server = await listenOwnMobileRelay({
        operator: defaultOperator,
        clientId: defaultClientId,
        origin: 'http://127.0.0.1'
      })
      try {
        const session = await obtainSession(server.origin)

        const noAuth = await fetch(`${server.origin}/v1/desktop/auth/profile`)
        expect(noAuth.status).toBe(401)

        const withAuth = await fetch(`${server.origin}/v1/desktop/auth/profile`, {
          headers: { authorization: `Bearer ${session.accessToken}` }
        })
        expect(withAuth.status).toBe(200)
        const profile = (await withAuth.json()) as {
          userId: string
          cloudProfileId: string
          activeOrgId?: string
          email: string
          displayName?: string
        }
        expect(profile).toEqual({
          userId: defaultOperator.userId,
          cloudProfileId: expect.any(String),
          activeOrgId: defaultOperator.organizationId,
          email: defaultOperator.email,
          displayName: undefined
        })
      } finally {
        await server.close()
      }
    })

    it('invalidates session and refresh token on POST /v1/desktop/auth/logout', async () => {
      const server = await listenOwnMobileRelay({
        operator: defaultOperator,
        clientId: defaultClientId,
        origin: 'http://127.0.0.1'
      })
      try {
        const session = await obtainSession(server.origin)

        const logoutRes = await fetch(`${server.origin}/v1/desktop/auth/logout`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${session.accessToken}`,
            'content-type': 'application/json'
          },
          body: JSON.stringify({ refreshToken: session.refreshToken })
        })
        expect(logoutRes.status).toBe(200)

        // Subsequent use of access token -> 401
        const capRes = await fetch(`${server.origin}/v1/desktop/auth/capabilities`, {
          headers: { authorization: `Bearer ${session.accessToken}` }
        })
        expect(capRes.status).toBe(401)

        // Subsequent refresh -> 401
        const refreshRes = await fetch(`${server.origin}/v1/desktop/auth/refresh`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ refreshToken: session.refreshToken })
        })
        expect(refreshRes.status).toBe(401)
      } finally {
        await server.close()
      }
    })
  })

  describe('POST /v1/desktop/auth/relay-token with session token', () => {
    it('accepts a valid session token, rejects the old fixed operator token, and binds identity', async () => {
      const server = await listenOwnMobileRelay({
        operator: defaultOperator,
        clientId: defaultClientId,
        origin: 'http://127.0.0.1'
      })
      try {
        const verifier = 'valid-code-verifier-string-12345678901234567890'
        const challenge = Buffer.from(
          await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
        ).toString('base64url')

        const query = `client_id=${defaultClientId}&redirect_uri=http://127.0.0.1:4000/auth/callback&code_challenge_method=S256&code_challenge=${challenge}&response_type=code&state=s1&nonce=n1&local_profile_id=local-custom-profile`
        const loginRes = await fetch(`${server.origin}/v1/desktop/auth/authorize?${query}`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            email: defaultOperator.email,
            password: defaultOperator.password
          }).toString(),
          redirect: 'manual'
        })
        const location = new URL(loginRes.headers.get('location')!)
        const code = location.searchParams.get('code')!

        const sessionRes = await fetch(`${server.origin}/v1/desktop/auth/session`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            code,
            codeVerifier: verifier,
            nonce: 'n1',
            redirectUri: 'http://127.0.0.1:4000/auth/callback',
            state: 's1',
            localProfileId: 'local-custom-profile'
          })
        })
        const session = (await sessionRes.json()) as { accessToken: string }

        // Reject old fixed operator token
        const oldFixedRes = await fetch(`${server.origin}/v1/desktop/auth/relay-token`, {
          method: 'POST',
          headers: {
            authorization: 'Bearer fixed-operator-token',
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            relayHostId: 'host-1',
            hostPublicKeyB64: 'key-1'
          })
        })
        expect(oldFixedRes.status).toBe(401)

        // Accept session token
        const validRes = await fetch(`${server.origin}/v1/desktop/auth/relay-token`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${session.accessToken}`,
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            relayHostId: 'host-1',
            hostPublicKeyB64: 'key-1'
          })
        })
        expect(validRes.status).toBe(200)
        const validBody = (await validRes.json()) as { relayToken: string; expiresAt: number }
        expect(validBody.relayToken).toBeTruthy()
        expect(validBody.expiresAt).toBeGreaterThan(Date.now())
      } finally {
        await server.close()
      }
    })

    it('binds session cloudProfileId to the relay-token grant when local_profile_id differs from operator profileId', async () => {
      const server = await listenOwnMobileRelay({
        operator: defaultOperator, // profileId is 'prof-op-1'
        clientId: defaultClientId,
        origin: 'http://127.0.0.1'
      })
      try {
        const localProfileId = 'local-default' // Distinct from 'prof-op-1'
        const verifier = 'valid-code-verifier-string-12345678901234567890'
        const challenge = Buffer.from(
          await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
        ).toString('base64url')

        const query = `client_id=${defaultClientId}&redirect_uri=http://127.0.0.1:4000/auth/callback&code_challenge_method=S256&code_challenge=${challenge}&response_type=code&state=s1&nonce=n1&local_profile_id=${localProfileId}`
        const loginRes = await fetch(`${server.origin}/v1/desktop/auth/authorize?${query}`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            email: defaultOperator.email,
            password: defaultOperator.password
          }).toString(),
          redirect: 'manual'
        })
        const location = new URL(loginRes.headers.get('location')!)
        const code = location.searchParams.get('code')!

        const sessionRes = await fetch(`${server.origin}/v1/desktop/auth/session`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            code,
            codeVerifier: verifier,
            nonce: 'n1',
            redirectUri: 'http://127.0.0.1:4000/auth/callback',
            state: 's1',
            localProfileId
          })
        })
        const session = (await sessionRes.json()) as {
          accessToken: string
          cloud: { cloudProfileId: string; userId: string; activeOrgId?: string }
        }
        expect(session.cloud.cloudProfileId).toBe(localProfileId)

        const hostKeys = nacl.box.keyPair()
        const keypair: E2EEKeypair = {
          publicKey: hostKeys.publicKey,
          secretKey: hostKeys.secretKey,
          publicKeyB64: Buffer.from(hostKeys.publicKey).toString('base64')
        }
        const relayHostId = deriveRelayHostId(hostKeys.publicKey)

        const tokenRes = await fetch(`${server.origin}/v1/desktop/auth/relay-token`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${session.accessToken}`,
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            relayHostId,
            hostPublicKeyB64: keypair.publicKeyB64
          })
        })
        expect(tokenRes.status).toBe(200)
        const { relayToken } = (await tokenRes.json()) as { relayToken: string }

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

        // Desktop client uses identity matching cloud response: profileId = session.cloud.cloudProfileId
        const clientIdentity = {
          userId: session.cloud.userId,
          profileId: session.cloud.cloudProfileId,
          organizationId: session.cloud.activeOrgId ?? ''
        }

        const client = new RelayControlClient({
          cellUrl,
          relayJwt: relayToken,
          relayHostId,
          assignmentEpoch,
          identity: clientIdentity,
          keypair,
          appVersion: '0.0.0-test',
          onConnectionOpen: vi.fn(),
          onDrain: vi.fn(),
          onClose: vi.fn()
        })

        const ack = await client.connect()
        expect(ack).toMatchObject({
          type: 'host-hello-ack',
          v: 1
        })
        expect(client.isLive()).toBe(true)
        client.closeNow()
      } finally {
        await server.close()
      }
    })
  })
})
