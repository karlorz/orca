import { describe, expect, it, vi } from 'vitest'
import { IncomingMessage } from 'node:http'
import { Socket } from 'node:net'
import { clientIdentityAddress } from './own-mobile-relay-client-identity'
import { createAuthThrottle } from './own-mobile-relay-auth-throttle'
import { loginOperatorAccount } from './own-mobile-relay-operator-auth'
import { createOwnMobileRelaySecurityStateMemory } from './own-mobile-relay-security-state-memory'
import { derivePasswordRecord, TEST_FAST_PASSWORD_POLICY } from './own-mobile-relay-password'

function requestWith(remoteAddress: string, forwardedFor: string): IncomingMessage {
  const socket = new Socket()
  Object.defineProperty(socket, 'remoteAddress', { value: remoteAddress })
  const request = new IncomingMessage(socket)
  request.headers = { 'x-forwarded-for': forwardedFor, 'x-real-ip': '198.51.100.250' }
  return request
}

describe('clientIdentityAddress', () => {
  it('uses the socket remote address and ignores spoofed X-Forwarded-For', () => {
    expect(clientIdentityAddress(requestWith('10.0.0.9', '198.51.100.7'))).toBe('10.0.0.9')
  })
})

describe('own-mobile-relay throttle client identity', () => {
  it('passes the socket address into throttle.check and ignores spoofed X-Forwarded-For', async () => {
    const throttle = createAuthThrottle({ maxFailures: 5, windowMs: 60_000 })
    const check = vi.spyOn(throttle, 'check')
    const recordFailure = vi.spyOn(throttle, 'recordFailure')
    const securityState = createOwnMobileRelaySecurityStateMemory()
    await securityState.bootstrapAccount({
      email: 'admin@example.com',
      userId: 'usr-admin',
      profileId: 'prf-admin',
      organizationId: 'org-admin',
      passwordRecord: await derivePasswordRecord(
        'correct-horse-battery-staple-fixture',
        TEST_FAST_PASSWORD_POLICY
      )
    })

    await loginOperatorAccount(
      requestWith('10.0.0.1', '198.51.100.7'),
      'admin@example.com',
      'wrong-password-!!!!',
      {
        securityState,
        throttle,
        passwordPolicy: TEST_FAST_PASSWORD_POLICY
      }
    )

    expect(check).toHaveBeenCalledWith('admin@example.com', '10.0.0.1')
    expect(recordFailure).toHaveBeenCalledWith('admin@example.com', '10.0.0.1')
    expect(check.mock.calls.flat()).not.toContain('198.51.100.7')
    expect(recordFailure.mock.calls.flat()).not.toContain('198.51.100.7')
  })
})
