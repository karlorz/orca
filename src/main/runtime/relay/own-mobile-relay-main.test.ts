import { describe, expect, it } from 'vitest'
import { parseOwnRelayEnv } from './own-mobile-relay-main'

describe('own-mobile-relay env parsing', () => {
  const completeEnv = {
    OWN_RELAY_ORIGIN: 'https://orca-relay.karldigi.dev',
    OWN_RELAY_CLIENT_ID: 'orca-desktop-prod',
    OWN_RELAY_OPERATOR_EMAIL: 'operator@example.com',
    OWN_RELAY_OPERATOR_PASSWORD: 'secret-password-123',
    OWN_RELAY_OPERATOR_USER_ID: 'user-op-1',
    OWN_RELAY_OPERATOR_PROFILE_ID: 'prof-op-1'
  }

  it('parses valid minimal required env variables with defaults', () => {
    const options = parseOwnRelayEnv(completeEnv)
    expect(options).toEqual({
      origin: 'https://orca-relay.karldigi.dev',
      clientId: 'orca-desktop-prod',
      listenHost: '127.0.0.1',
      listenPort: 8093,
      operator: {
        email: 'operator@example.com',
        password: 'secret-password-123',
        userId: 'user-op-1',
        profileId: 'prof-op-1',
        organizationId: ''
      }
    })
  })

  it('parses optional listen host, listen port, and operator organizationId', () => {
    const options = parseOwnRelayEnv({
      ...completeEnv,
      OWN_RELAY_LISTEN_HOST: '0.0.0.0',
      OWN_RELAY_LISTEN_PORT: '9000',
      OWN_RELAY_OPERATOR_ORG_ID: 'org-test-99'
    })
    expect(options).toEqual({
      origin: 'https://orca-relay.karldigi.dev',
      clientId: 'orca-desktop-prod',
      listenHost: '0.0.0.0',
      listenPort: 9000,
      operator: {
        email: 'operator@example.com',
        password: 'secret-password-123',
        userId: 'user-op-1',
        profileId: 'prof-op-1',
        organizationId: 'org-test-99'
      }
    })
  })

  it('throws a descriptive error when required env vars are missing without exposing secret values', () => {
    const requiredKeys = [
      'OWN_RELAY_ORIGIN',
      'OWN_RELAY_CLIENT_ID',
      'OWN_RELAY_OPERATOR_EMAIL',
      'OWN_RELAY_OPERATOR_PASSWORD',
      'OWN_RELAY_OPERATOR_USER_ID',
      'OWN_RELAY_OPERATOR_PROFILE_ID'
    ] as const

    for (const key of requiredKeys) {
      const partialEnv = { ...completeEnv }
      delete (partialEnv as Record<string, string>)[key]
      expect(() => parseOwnRelayEnv(partialEnv)).toThrow(
        new RegExp(`Missing required environment variable: ${key}`)
      )
    }
  })

  it('rejects invalid numeric port', () => {
    expect(() =>
      parseOwnRelayEnv({
        ...completeEnv,
        OWN_RELAY_LISTEN_PORT: 'invalid-port'
      })
    ).toThrow(/Invalid OWN_RELAY_LISTEN_PORT/)
  })
})
