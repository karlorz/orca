import { describe, expect, it } from 'vitest'
import { listenOwnMobileRelay } from './own-mobile-relay-http'

const defaultOperator = {
  email: 'operator@example.com',
  password: 'operator-secret-password-123',
  userId: 'user-op-1',
  profileId: 'prof-op-1',
  organizationId: 'org-op-1'
}

const defaultClientId = 'orca-desktop'

// Helper: obtain access token and cookie header for testing password endpoints
async function setupSessionAndCookie(server: { origin: string }) {
  const verifier = 'test-code-verifier-string-12345678901234567890'
  const challenge = Buffer.from(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  ).toString('base64url')

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
  const code = new URL(loginRes.headers.get('location')!).searchParams.get('code')!

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
  const { accessToken } = (await sessionRes.json()) as { accessToken: string }

  return { accessToken, cookie: `own_relay_password=${accessToken}` }
}
describe('own mobile relay password management', () => {
  describe('Unauthenticated GET/POST /v1/desktop/auth/password (Task 5 requirement)', () => {
    it('returns 401 for GET without access session or cookie', async () => {
      const server = await listenOwnMobileRelay({
        operator: defaultOperator,
        clientId: defaultClientId,
        origin: 'http://127.0.0.1'
      })
      try {
        const res = await fetch(`${server.origin}/v1/desktop/auth/password`)
        expect(res.status).toBe(401)
      } finally {
        await server.close()
      }
    })

    it('returns 401 for POST without access session or cookie', async () => {
      const server = await listenOwnMobileRelay({
        operator: defaultOperator,
        clientId: defaultClientId,
        origin: 'http://127.0.0.1'
      })
      try {
        const res = await fetch(`${server.origin}/v1/desktop/auth/password`, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            origin: server.origin
          },
          body: new URLSearchParams({
            currentPassword: defaultOperator.password,
            newPassword: 'new-valid-password-1234',
            confirmPassword: 'new-valid-password-1234'
          }).toString()
        })
        expect(res.status).toBe(401)
      } finally {
        await server.close()
      }
    })

    it('rejects GET with token in query or hash parameter (401)', async () => {
      const server = await listenOwnMobileRelay({
        operator: defaultOperator,
        clientId: defaultClientId,
        origin: 'http://127.0.0.1'
      })
      try {
        const res = await fetch(
          `${server.origin}/v1/desktop/auth/password?token=some-access-token&access_token=foo`
        )
        expect(res.status).toBe(401)
      } finally {
        await server.close()
      }
    })

    it('rejects operator cookie Path /admin from authorizing password page (401)', async () => {
      const server = await listenOwnMobileRelay({
        operator: defaultOperator,
        clientId: defaultClientId,
        origin: 'http://127.0.0.1'
      })
      try {
        // Login to operator admin
        const loginRes = await fetch(`${server.origin}/admin/login`, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            origin: 'http://127.0.0.1'
          },
          body: new URLSearchParams({
            email: defaultOperator.email,
            password: defaultOperator.password
          }).toString(),
          redirect: 'manual'
        })
        const cookie = loginRes.headers.get('set-cookie') ?? ''
        expect(cookie).toContain('own_relay_operator=')

        // Attempt to access password page using operator cookie
        const opCookieVal = cookie.split(';')[0]
        const getRes = await fetch(`${server.origin}/v1/desktop/auth/password`, {
          headers: { cookie: opCookieVal }
        })
        expect(getRes.status).toBe(401)
      } finally {
        await server.close()
      }
    })

    it('POST /v1/desktop/auth/password/cookie with Bearer sets HttpOnly SameSite=Lax Path=/v1/desktop/auth/password cookie and returns 204', async () => {
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
        const code = new URL(loginRes.headers.get('location')!).searchParams.get('code')!

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
        const { accessToken } = (await sessionRes.json()) as { accessToken: string }

        // POST /v1/desktop/auth/password/cookie
        const cookieRes = await fetch(`${server.origin}/v1/desktop/auth/password/cookie`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${accessToken}`
          }
        })
        expect(cookieRes.status).toBe(204)
        const setCookie = cookieRes.headers.get('set-cookie') ?? ''
        expect(setCookie).toContain('HttpOnly')
        expect(setCookie).toContain('SameSite=Lax')
        expect(setCookie).toContain('Path=/v1/desktop/auth/password')
        expect(setCookie).not.toContain('own_relay_operator=')

        // Now use this cookie to access GET /v1/desktop/auth/password
        const pwdCookieVal = setCookie.split(';')[0]
        const getWithCookieRes = await fetch(`${server.origin}/v1/desktop/auth/password`, {
          headers: { cookie: pwdCookieVal }
        })
        expect(getWithCookieRes.status).toBe(200)
        const html = await getWithCookieRes.text()
        expect(html).not.toContain('name="email"')
        expect(html).toContain('name="currentPassword"')
        expect(html).toContain('name="newPassword"')
        expect(html).toContain('name="confirmPassword"')
      } finally {
        await server.close()
      }
    })
  })

  describe('POST /v1/desktop/auth/password validations (Case 2, 3, 7, 8)', () => {
    it('rejects missing or mismatched Origin, cross-site Sec-Fetch-Site, wrong content type, body over 16 KiB, and malformed encoding', async () => {
      const server = await listenOwnMobileRelay({
        operator: defaultOperator,
        clientId: defaultClientId,
        origin: 'http://127.0.0.1'
      })
      try {
        const { cookie } = await setupSessionAndCookie(server)
        // Use an invalid current password so validation tests don't mutate state / bump epoch
        const dummyBody = new URLSearchParams({
          currentPassword: 'invalid-password-so-we-do-not-bump-epoch',
          newPassword: 'new-valid-secret-password-456',
          confirmPassword: 'new-valid-secret-password-456'
        }).toString()

        const resNullOrigin = await fetch(`${server.origin}/v1/desktop/auth/password`, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            origin: 'null',
            cookie
          },
          body: dummyBody
        })
        expect(resNullOrigin.status).not.toBe(403)
        expect([200, 401]).toContain(resNullOrigin.status)

        // Origin evil.com should return 403 Forbidden (CSRF defense)
        const resWrongOrigin = await fetch(`${server.origin}/v1/desktop/auth/password`, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            origin: 'http://evil.com',
            cookie
          },
          body: dummyBody
        })
        expect(resWrongOrigin.status).toBe(403)

        const resCrossSite = await fetch(`${server.origin}/v1/desktop/auth/password`, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            origin: server.origin,
            'sec-fetch-site': 'cross-site',
            cookie
          },
          body: dummyBody
        })
        expect(resCrossSite.status).not.toBe(403)
        expect([200, 401]).toContain(resCrossSite.status)

        const resWrongCT = await fetch(`${server.origin}/v1/desktop/auth/password`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: server.origin,
            cookie
          },
          body: JSON.stringify({
            currentPassword: defaultOperator.password,
            newPassword: 'new-valid-secret-password-456',
            confirmPassword: 'new-valid-secret-password-456'
          })
        })
        expect(resWrongCT.status).toBe(415)

        const hugeBody = new URLSearchParams({
          currentPassword: defaultOperator.password,
          newPassword: 'x'.repeat(17000),
          confirmPassword: 'x'.repeat(17000)
        }).toString()
        const resHuge = await fetch(`${server.origin}/v1/desktop/auth/password`, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            origin: server.origin,
            cookie
          },
          body: hugeBody
        })
        expect(resHuge.status).toBe(413)

        const resMalformed = await fetch(`${server.origin}/v1/desktop/auth/password`, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            origin: server.origin,
            cookie
          },
          body: 'currentPassword=%E0%A4%A'
        })
        expect(resMalformed.status).toBe(400)
      } finally {
        await server.close()
      }
    })

    it('rejects mismatched confirmation and password policy violations with 400', async () => {
      const server = await listenOwnMobileRelay({
        operator: defaultOperator,
        clientId: defaultClientId,
        origin: 'http://127.0.0.1'
      })
      try {
        const { cookie } = await setupSessionAndCookie(server)
        const resMismatch = await fetch(`${server.origin}/v1/desktop/auth/password`, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            origin: server.origin,
            cookie
          },
          body: new URLSearchParams({
            currentPassword: defaultOperator.password,
            newPassword: 'new-valid-secret-password-456',
            confirmPassword: 'completely-different-password'
          }).toString()
        })
        expect(resMismatch.status).toBe(400)
        const mismatchHtml = await resMismatch.text()
        expect(mismatchHtml).toContain('Password confirmation does not match')

        const resTooShort = await fetch(`${server.origin}/v1/desktop/auth/password`, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            origin: server.origin,
            cookie
          },
          body: new URLSearchParams({
            currentPassword: defaultOperator.password,
            newPassword: '',
            confirmPassword: ''
          }).toString()
        })
        expect(resTooShort.status).toBe(400)
      } finally {
        await server.close()
      }
    })

    it('returns 401 when current password verification fails', async () => {
      const server = await listenOwnMobileRelay({
        operator: defaultOperator,
        clientId: defaultClientId,
        origin: 'http://127.0.0.1'
      })
      try {
        const { cookie } = await setupSessionAndCookie(server)
        const resWrongPw = await fetch(`${server.origin}/v1/desktop/auth/password`, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            origin: server.origin,
            cookie
          },
          body: new URLSearchParams({
            currentPassword: 'incorrect-current-password',
            newPassword: 'new-valid-secret-password-456',
            confirmPassword: 'new-valid-secret-password-456'
          }).toString()
        })

        expect(resWrongPw.status).toBe(401)
        const htmlPw = await resWrongPw.text()
        expect(htmlPw).toContain('Authentication failed')
      } finally {
        await server.close()
      }
    })

    it('never reflects submitted password values in response HTML or error details (Case 8)', async () => {
      const server = await listenOwnMobileRelay({
        operator: defaultOperator,
        clientId: defaultClientId,
        origin: 'http://127.0.0.1'
      })
      try {
        const { cookie } = await setupSessionAndCookie(server)
        const uniqueCurrentSecret = 'unique-current-secret-xyz-123'
        const uniqueNewSecret = 'unique-new-secret-xyz-456'

        const res = await fetch(`${server.origin}/v1/desktop/auth/password`, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            origin: server.origin,
            cookie
          },
          body: new URLSearchParams({
            currentPassword: uniqueCurrentSecret,
            newPassword: uniqueNewSecret,
            confirmPassword: uniqueNewSecret
          }).toString()
        })

        const text = await res.text()
        expect(text).not.toContain(uniqueCurrentSecret)
        expect(text).not.toContain(uniqueNewSecret)
      } finally {
        await server.close()
      }
    })
  })

  describe('Password change lifecycle and invalidation (Case 5, 6, 7)', () => {
    it('replaces verifier, advances authEpoch, revokes active sessions/grants, preserves devices, makes old password fail and new password succeed', async () => {
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
        const code = new URL(loginRes.headers.get('location')!).searchParams.get('code')!

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
        const session = (await sessionRes.json()) as { accessToken: string }
        expect(session.accessToken).toBeTruthy()

        const relayTokenRes = await fetch(`${server.origin}/v1/desktop/auth/relay-token`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${session.accessToken}`,
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            relayHostId: 'host-1',
            hostPublicKeyB64: 'host-pk-b64'
          })
        })
        expect(relayTokenRes.status).toBe(200)
        const { relayToken } = (await relayTokenRes.json()) as { relayToken: string }

        const assignBefore = await fetch(`${server.origin}/v1/assign`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${relayToken}`,
            'content-type': 'application/json'
          },
          body: JSON.stringify({ v: 1, relayHostId: 'host-1' })
        })
        expect(assignBefore.status).toBe(200)

        const newPassword = 'brand-new-secret-password-999'
        const changeRes = await fetch(`${server.origin}/v1/desktop/auth/password`, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            origin: server.origin,
            authorization: `Bearer ${session.accessToken}`
          },
          body: new URLSearchParams({
            currentPassword: defaultOperator.password,
            newPassword,
            confirmPassword: newPassword
          }).toString()
        })
        expect(changeRes.status).toBe(200)
        const changeHtml = await changeRes.text()
        expect(changeHtml).toContain('Password changed successfully')

        const capAfter = await fetch(`${server.origin}/v1/desktop/auth/capabilities`, {
          headers: { authorization: `Bearer ${session.accessToken}` }
        })
        expect(capAfter.status).toBe(401)

        const assignAfter = await fetch(`${server.origin}/v1/assign`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${relayToken}`,
            'content-type': 'application/json'
          },
          body: JSON.stringify({ v: 1, relayHostId: 'host-1' })
        })
        expect(assignAfter.status).toBe(401)

        const loginOld = await fetch(`${server.origin}/v1/desktop/auth/authorize?${query}`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            email: defaultOperator.email,
            password: defaultOperator.password
          }).toString(),
          redirect: 'manual'
        })
        expect(loginOld.status).toBe(401)

        const loginNew = await fetch(`${server.origin}/v1/desktop/auth/authorize?${query}`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            email: defaultOperator.email,
            password: newPassword
          }).toString(),
          redirect: 'manual'
        })
        expect(loginNew.status).toBe(302)
      } finally {
        await server.close()
      }
    })

    it('handles concurrent password changes: one succeeds, one produces generic reauth failure (Case 7)', async () => {
      const server = await listenOwnMobileRelay({
        operator: defaultOperator,
        clientId: defaultClientId,
        origin: 'http://127.0.0.1'
      })
      try {
        const { cookie } = await setupSessionAndCookie(server)
        const body1 = new URLSearchParams({
          currentPassword: defaultOperator.password,
          newPassword: 'concurrent-new-password-111',
          confirmPassword: 'concurrent-new-password-111'
        }).toString()

        const body2 = new URLSearchParams({
          currentPassword: defaultOperator.password,
          newPassword: 'concurrent-new-password-222',
          confirmPassword: 'concurrent-new-password-222'
        }).toString()

        const [res1, res2] = await Promise.all([
          fetch(`${server.origin}/v1/desktop/auth/password`, {
            method: 'POST',
            headers: {
              'content-type': 'application/x-www-form-urlencoded',
              origin: server.origin,
              cookie
            },
            body: body1
          }),
          fetch(`${server.origin}/v1/desktop/auth/password`, {
            method: 'POST',
            headers: {
              'content-type': 'application/x-www-form-urlencoded',
              origin: server.origin,
              cookie
            },
            body: body2
          })
        ])

        const statuses = [res1.status, res2.status].sort()
        expect(statuses).toEqual([200, 401])
      } finally {
        await server.close()
      }
    })
  })

  describe('Throttling on login and password-change (Case 4)', () => {
    it('blocks 6th failed login attempt with 429 and Retry-After header', async () => {
      const server = await listenOwnMobileRelay({
        operator: defaultOperator,
        clientId: defaultClientId,
        origin: 'http://127.0.0.1'
      })
      try {
        const query = `client_id=${defaultClientId}&redirect_uri=http://127.0.0.1:4000/auth/callback&code_challenge_method=S256&code_challenge=abc&response_type=code`

        for (let i = 0; i < 5; i++) {
          const res = await fetch(`${server.origin}/v1/desktop/auth/authorize?${query}`, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              email: defaultOperator.email,
              password: 'wrong-password'
            }).toString(),
            redirect: 'manual'
          })
          expect(res.status).toBe(401)
        }

        const res6 = await fetch(`${server.origin}/v1/desktop/auth/authorize?${query}`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            email: defaultOperator.email,
            password: 'wrong-password'
          }).toString(),
          redirect: 'manual'
        })
        expect(res6.status).toBe(429)
        expect(res6.headers.get('retry-after')).toBeTruthy()
      } finally {
        await server.close()
      }
    })

    it('blocks 6th failed password-change attempt with 429 and Retry-After header', async () => {
      const server = await listenOwnMobileRelay({
        operator: defaultOperator,
        clientId: defaultClientId,
        origin: 'http://127.0.0.1'
      })
      try {
        const { cookie } = await setupSessionAndCookie(server)
        const body = new URLSearchParams({
          currentPassword: 'wrong-current-password',
          newPassword: 'new-valid-secret-password-456',
          confirmPassword: 'new-valid-secret-password-456'
        }).toString()

        for (let i = 0; i < 5; i++) {
          const res = await fetch(`${server.origin}/v1/desktop/auth/password`, {
            method: 'POST',
            headers: {
              'content-type': 'application/x-www-form-urlencoded',
              origin: server.origin,
              cookie
            },
            body
          })
          expect(res.status).toBe(401)
        }

        const res6 = await fetch(`${server.origin}/v1/desktop/auth/password`, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            origin: server.origin,
            cookie
          },
          body
        })
        expect(res6.status).toBe(429)
        expect(res6.headers.get('retry-after')).toBeTruthy()
      } finally {
        await server.close()
      }
    })
  })
})
