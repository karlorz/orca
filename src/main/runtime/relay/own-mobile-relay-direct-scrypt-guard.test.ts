import { describe, it, expect, vi } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { readUrlEncodedBodySafely } from './own-mobile-relay-http-utils'
import * as passwordModule from './own-mobile-relay-password'
import { createAuthThrottle } from './own-mobile-relay-auth-throttle'
import { handlePasswordPost } from './own-mobile-relay-password-handler'
import { createOwnMobileRelaySecurityStateMemory } from './own-mobile-relay-security-state-memory'

describe('Direct throttle and derivation-skip verification', () => {
  it('does NOT call verifyPasswordRecord or derivePasswordRecord when throttle is blocked (Case 4 no scrypt)', async () => {
    const throttle = createAuthThrottle({ maxFailures: 5, windowMs: 60000 })
    const email = 'user@example.com'
    const ip = '127.0.0.1'

    for (let i = 0; i < 5; i++) {
      throttle.recordFailure(email, ip)
    }

    const verifySpy = vi.spyOn(passwordModule, 'verifyPasswordRecord')
    const deriveSpy = vi.spyOn(passwordModule, 'derivePasswordRecord')

    const securityState = createOwnMobileRelaySecurityStateMemory()
    await securityState.bootstrapAccount({
      email,
      userId: 'usr1',
      profileId: 'prf1',
      organizationId: 'org1',
      passwordRecord: await passwordModule.derivePasswordRecord(
        'original-super-secret-1234',
        passwordModule.TEST_FAST_PASSWORD_POLICY
      )
    })

    verifySpy.mockClear()
    deriveSpy.mockClear()

    const req = {
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'http://127.0.0.1'
      },
      socket: { remoteAddress: ip },
      on(event: string, cb: (data?: unknown) => void) {
        if (event === 'data') {
          cb(
            Buffer.from(
              new URLSearchParams({
                email,
                currentPassword: 'some-password-attempt-123',
                newPassword: 'new-valid-secret-password-456',
                confirmPassword: 'new-valid-secret-password-456'
              }).toString()
            )
          )
        }
        if (event === 'end') {
          cb()
        }
        return this
      }
    } as unknown as IncomingMessage

    let responseStatus = 0
    const responseHeaders: Record<string, string> = {}
    const res = {
      writeHead(status: number, headers?: Record<string, string>) {
        responseStatus = status
        if (headers) {
          Object.assign(responseHeaders, headers)
        }
        return this
      },
      end() {
        return this
      }
    } as unknown as ServerResponse

    await handlePasswordPost(
      req,
      securityState,
      'http://127.0.0.1',
      res,
      throttle,
      passwordModule.TEST_FAST_PASSWORD_POLICY
    )

    expect(responseStatus).toBe(429)
    expect(responseHeaders['retry-after']).toBeTruthy()
    expect(verifySpy).not.toHaveBeenCalled()
    expect(deriveSpy).not.toHaveBeenCalled()

    verifySpy.mockRestore()
    deriveSpy.mockRestore()
    await securityState.close()
  })

  it('enforces 16 KiB limit on readUrlEncodedBodySafely and throws payload_too_large or malformed_encoding', async () => {
    const bigData = Buffer.alloc(16385, 'a')
    const bigReq = {
      on(event: string, cb: (data?: unknown) => void) {
        if (event === 'data') {
          cb(bigData)
        }
        if (event === 'end') {
          cb()
        }
        return this
      }
    } as unknown as IncomingMessage

    await expect(readUrlEncodedBodySafely(bigReq, 16384)).rejects.toThrow(
      expect.objectContaining({ code: 'payload_too_large' })
    )

    const malformedReq = {
      on(event: string, cb: (data?: unknown) => void) {
        if (event === 'data') {
          cb(Buffer.from('email=%E0%A4%A&foo=bar'))
        }
        if (event === 'end') {
          cb()
        }
        return this
      }
    } as unknown as IncomingMessage

    await expect(readUrlEncodedBodySafely(malformedReq, 16384)).rejects.toThrow(
      expect.objectContaining({ code: 'malformed_encoding' })
    )
  })
})
