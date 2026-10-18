import { describe, expect, it } from 'vitest'
import { isAllowedPasswordOrigin } from './own-mobile-relay-password-origin'
import { listenOwnMobileRelay } from './own-mobile-relay-http'
import { loginAndObtainSessionToken, TEST_OPERATOR } from './own-mobile-relay-test-auth'
import { TEST_FAST_PASSWORD_POLICY } from './own-mobile-relay-password'

const CONFIGURED = 'https://relay.example.test'
const ADVERTISED = 'https://cell.example.test'
const ALLOWED = [CONFIGURED, ADVERTISED]

describe('isAllowedPasswordOrigin', () => {
  it('rejects a foreign Origin even when Referer matches a configured origin', () => {
    expect(
      isAllowedPasswordOrigin(
        'https://evil.example',
        `${CONFIGURED}/v1/desktop/auth/password`,
        'relay.example.test',
        ALLOWED
      )
    ).toBe(false)
  })

  it.each(['null', '', '   '])(
    'rejects opaque or empty Origin %j even with a matching Host',
    (origin) => {
      expect(isAllowedPasswordOrigin(origin, undefined, 'relay.example.test', ALLOWED)).toBe(false)
    }
  )

  it('rejects Origin null even when Referer matches a configured origin', () => {
    expect(
      isAllowedPasswordOrigin(
        'null',
        `${ADVERTISED}/v1/desktop/auth/password`,
        'unrelated.example',
        ALLOWED
      )
    ).toBe(false)
  })

  it('allows an advertised-relay Origin and rejects a missing Host/Referer with Origin null', () => {
    expect(isAllowedPasswordOrigin(ADVERTISED, undefined, undefined, ALLOWED)).toBe(true)
    expect(isAllowedPasswordOrigin('null', undefined, undefined, ALLOWED)).toBe(false)
  })

  it.each(['https://evil.example/password', 'invalid-url', ''])(
    'rejects untrusted Referer %j before Host fallback',
    (referer) => {
      expect(isAllowedPasswordOrigin(undefined, referer, 'relay.example.test', ALLOWED)).toBe(false)
    }
  )

  it('allows missing Origin with a configured Referer or Host for non-browser clients', () => {
    expect(isAllowedPasswordOrigin(undefined, `${CONFIGURED}/password`, undefined, ALLOWED)).toBe(
      true
    )
    expect(isAllowedPasswordOrigin(undefined, undefined, 'relay.example.test', ALLOWED)).toBe(true)
    expect(isAllowedPasswordOrigin(undefined, undefined, 'evil.example', ALLOWED)).toBe(false)
  })

  it('enforces the Origin policy through the shipped HTTP password handler', async () => {
    const server = await listenOwnMobileRelay({
      operator: TEST_OPERATOR,
      origin: 'http://127.0.0.1',
      passwordPolicy: TEST_FAST_PASSWORD_POLICY
    })
    try {
      const token = await loginAndObtainSessionToken(server.origin)
      const rejectedHeaders: Record<string, string>[] = [
        { origin: 'null' },
        { origin: '' },
        { referer: 'https://evil.example/password' },
        { origin: 'https://evil.example', referer: `${server.origin}/password` }
      ]
      for (const headers of rejectedHeaders) {
        const response = await fetch(`${server.origin}/v1/desktop/auth/password`, {
          method: 'POST',
          headers: {
            ...headers,
            cookie: `own_relay_password=${token}`,
            'content-type': 'application/x-www-form-urlencoded'
          },
          body: new URLSearchParams({
            currentPassword: 'incorrect-password',
            newPassword: 'new-password-fixture',
            confirmPassword: 'new-password-fixture'
          })
        })
        expect(response.status).toBe(403)
        await response.text()
      }
      const health = await fetch(`${server.origin}/health`)
      expect(health.status).toBe(200)
      await health.text()
    } finally {
      await server.close()
    }
  })
})
