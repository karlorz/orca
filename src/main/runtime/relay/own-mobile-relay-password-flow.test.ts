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

describe('own mobile relay password management', () => {
  describe('GET /v1/desktop/auth/password', () => {
    it('returns a no-store HTML form with restrictive CSP, frame, form-action, and MIME-sniffing headers (Case 1)', async () => {
      const server = await listenOwnMobileRelay({
        operator: defaultOperator,
        clientId: defaultClientId,
        origin: 'http://127.0.0.1'
      })
      try {
        const res = await fetch(`${server.origin}/v1/desktop/auth/password`)
        expect(res.status).toBe(200)
        expect(res.headers.get('content-type')).toContain('text/html')
        expect(res.headers.get('cache-control')).toContain('no-store')
        expect(res.headers.get('x-frame-options')).toBe('DENY')
        expect(res.headers.get('x-content-type-options')).toBe('nosniff')
        const csp = res.headers.get('content-security-policy') ?? ''
        expect(csp).toContain("default-src 'none'")
        expect(csp).toContain("form-action 'self'")
        expect(csp).toContain("frame-ancestors 'none'")

        const html = await res.text()
        expect(html).toContain('name="email"')
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
        const validBody = new URLSearchParams({
          email: defaultOperator.email,
          currentPassword: defaultOperator.password,
          newPassword: 'new-valid-secret-password-456',
          confirmPassword: 'new-valid-secret-password-456'
        }).toString()

        const resNoOrigin = await fetch(`${server.origin}/v1/desktop/auth/password`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: validBody
        })
        expect(resNoOrigin.status).toBe(403)

        const resWrongOrigin = await fetch(`${server.origin}/v1/desktop/auth/password`, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            origin: 'http://evil.com'
          },
          body: validBody
        })
        expect(resWrongOrigin.status).toBe(403)

        const resCrossSite = await fetch(`${server.origin}/v1/desktop/auth/password`, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            origin: server.origin,
            'sec-fetch-site': 'cross-site'
          },
          body: validBody
        })
        expect(resCrossSite.status).toBe(403)

        const resWrongCT = await fetch(`${server.origin}/v1/desktop/auth/password`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: server.origin
          },
          body: JSON.stringify({
            email: defaultOperator.email,
            currentPassword: defaultOperator.password,
            newPassword: 'new-valid-secret-password-456',
            confirmPassword: 'new-valid-secret-password-456'
          })
        })
        expect(resWrongCT.status).toBe(415)

        const hugeBody = new URLSearchParams({
          email: defaultOperator.email,
          currentPassword: defaultOperator.password,
          newPassword: 'x'.repeat(17000),
          confirmPassword: 'x'.repeat(17000)
        }).toString()
        const resHuge = await fetch(`${server.origin}/v1/desktop/auth/password`, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            origin: server.origin
          },
          body: hugeBody
        })
        expect(resHuge.status).toBe(413)

        const resMalformed = await fetch(`${server.origin}/v1/desktop/auth/password`, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            origin: server.origin
          },
          body: 'email=%E0%A4%A&currentPassword=abc'
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
        const resMismatch = await fetch(`${server.origin}/v1/desktop/auth/password`, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            origin: server.origin
          },
          body: new URLSearchParams({
            email: defaultOperator.email,
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
            origin: server.origin
          },
          body: new URLSearchParams({
            email: defaultOperator.email,
            currentPassword: defaultOperator.password,
            newPassword: 'short',
            confirmPassword: 'short'
          }).toString()
        })
        expect(resTooShort.status).toBe(400)
      } finally {
        await server.close()
      }
    })

    it('returns indistinguishable response status/body shape for wrong email and wrong password (Case 3)', async () => {
      const server = await listenOwnMobileRelay({
        operator: defaultOperator,
        clientId: defaultClientId,
        origin: 'http://127.0.0.1'
      })
      try {
        const resWrongEmail = await fetch(`${server.origin}/v1/desktop/auth/password`, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            origin: server.origin
          },
          body: new URLSearchParams({
            email: 'nonexistent@example.com',
            currentPassword: defaultOperator.password,
            newPassword: 'new-valid-secret-password-456',
            confirmPassword: 'new-valid-secret-password-456'
          }).toString()
        })

        const resWrongPw = await fetch(`${server.origin}/v1/desktop/auth/password`, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            origin: server.origin
          },
          body: new URLSearchParams({
            email: defaultOperator.email,
            currentPassword: 'incorrect-current-password',
            newPassword: 'new-valid-secret-password-456',
            confirmPassword: 'new-valid-secret-password-456'
          }).toString()
        })

        expect(resWrongEmail.status).toBe(401)
        expect(resWrongPw.status).toBe(401)

        const htmlEmail = await resWrongEmail.text()
        const htmlPw = await resWrongPw.text()
        expect(htmlEmail).toBe(htmlPw)
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
        const uniqueCurrentSecret = 'unique-current-secret-xyz-123'
        const uniqueNewSecret = 'unique-new-secret-xyz-456'

        const res = await fetch(`${server.origin}/v1/desktop/auth/password`, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            origin: server.origin
          },
          body: new URLSearchParams({
            email: defaultOperator.email,
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
            origin: server.origin
          },
          body: new URLSearchParams({
            email: defaultOperator.email,
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
        const body1 = new URLSearchParams({
          email: defaultOperator.email,
          currentPassword: defaultOperator.password,
          newPassword: 'concurrent-new-password-111',
          confirmPassword: 'concurrent-new-password-111'
        }).toString()

        const body2 = new URLSearchParams({
          email: defaultOperator.email,
          currentPassword: defaultOperator.password,
          newPassword: 'concurrent-new-password-222',
          confirmPassword: 'concurrent-new-password-222'
        }).toString()

        const [res1, res2] = await Promise.all([
          fetch(`${server.origin}/v1/desktop/auth/password`, {
            method: 'POST',
            headers: {
              'content-type': 'application/x-www-form-urlencoded',
              origin: server.origin
            },
            body: body1
          }),
          fetch(`${server.origin}/v1/desktop/auth/password`, {
            method: 'POST',
            headers: {
              'content-type': 'application/x-www-form-urlencoded',
              origin: server.origin
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
        const body = new URLSearchParams({
          email: defaultOperator.email,
          currentPassword: 'wrong-current-password',
          newPassword: 'new-valid-secret-password-456',
          confirmPassword: 'new-valid-secret-password-456'
        }).toString()

        for (let i = 0; i < 5; i++) {
          const res = await fetch(`${server.origin}/v1/desktop/auth/password`, {
            method: 'POST',
            headers: {
              'content-type': 'application/x-www-form-urlencoded',
              origin: server.origin
            },
            body
          })
          expect(res.status).toBe(401)
        }

        const res6 = await fetch(`${server.origin}/v1/desktop/auth/password`, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            origin: server.origin
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
