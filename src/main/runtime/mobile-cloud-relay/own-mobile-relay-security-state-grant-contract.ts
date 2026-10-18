import { describe, it, expect, beforeEach } from 'vitest'
import {
  derivePasswordRecord,
  TEST_FAST_PASSWORD_POLICY,
  type PasswordRecord
} from './own-mobile-relay-password'
import type { OwnMobileRelaySecurityState } from './own-mobile-relay-security-state'

export function registerGrantLifecycleTests(
  createAdapter: () => Promise<OwnMobileRelaySecurityState> | OwnMobileRelaySecurityState
): void {
  describe('Relay Grant Lifecycle and Revocation', () => {
    let state: OwnMobileRelaySecurityState
    let passwordRecord: PasswordRecord

    beforeEach(async () => {
      state = await createAdapter()
      passwordRecord = await derivePasswordRecord(
        'correct-horse-battery-staple-1234',
        TEST_FAST_PASSWORD_POLICY
      )
    })

    it('validates relay grants by raw token or internal ID, enforces expiry and parent session binding', async () => {
      await state.bootstrapAccount({
        email: 'admin@example.com',
        userId: 'usr_1',
        profileId: 'prf_1',
        organizationId: 'org_1',
        passwordRecord
      })

      const t0 = 2_000_000
      const session = await state.issueAccessSession(
        {
          rawAccessToken: 'access-token-1',
          identity: {
            userId: 'usr_1',
            profileId: 'prf_1',
            organizationId: 'org_1',
            email: 'admin@example.com',
            cloudProfileId: 'c_prf_1'
          },
          ttlMs: 3600_000
        },
        t0
      )

      const rawRelayToken = 'raw-relay-token-abcde'
      const grantTtlMs = 1800_000
      const issuedGrant = await state.issueRelayGrant(
        {
          rawRelayToken,
          parentSessionId: session.sessionId,
          relayHostId: 'host_1234567890123456',
          hostPublicKeyB64: 'base64publickey==',
          identity: {
            userId: 'usr_1',
            profileId: 'c_prf_1',
            organizationId: 'org_1'
          },
          ttlMs: grantTtlMs
        },
        t0
      )

      expect(issuedGrant).not.toBeNull()
      expect(issuedGrant?.expiresAt).toBe(t0 + grantTtlMs)

      const admissionGrant = await state.validateRelayGrantByToken(rawRelayToken, t0 + 500)
      expect(admissionGrant).not.toBeNull()
      expect(admissionGrant?.grantId).toBe(issuedGrant?.grantId)
      expect(admissionGrant?.relayHostId).toBe('host_1234567890123456')
      expect(admissionGrant).not.toHaveProperty('rawRelayToken')
      expect(admissionGrant).not.toHaveProperty('relayTokenHash')

      const heartbeatGrant = await state.validateRelayGrantById(
        issuedGrant!.grantId,
        'host_1234567890123456',
        t0 + 1000
      )
      expect(heartbeatGrant).not.toBeNull()
      expect(heartbeatGrant?.grantId).toBe(issuedGrant?.grantId)

      const wrongHostGrant = await state.validateRelayGrantById(
        issuedGrant!.grantId,
        'wrong_host_id_123456',
        t0 + 1000
      )
      expect(wrongHostGrant).toBeNull()

      // When host key expiry is enabled (disabled=false), validate fails on wall-clock expiry
      await state.setHostKeyExpiryDisabled('host_1234567890123456', false)
      const expiredGrant = await state.validateRelayGrantByToken(rawRelayToken, t0 + grantTtlMs + 1)
      expect(expiredGrant).toBeNull()
    })

    it('invalidates parent session and its child grants on logout without requiring immediate hard deletion', async () => {
      await state.bootstrapAccount({
        email: 'admin@example.com',
        userId: 'usr_1',
        profileId: 'prf_1',
        organizationId: 'org_1',
        passwordRecord
      })

      const t0 = 3_000_000
      const session = await state.issueAccessSession(
        {
          rawAccessToken: 'access-for-logout',
          identity: {
            userId: 'usr_1',
            profileId: 'prf_1',
            organizationId: 'org_1',
            email: 'admin@example.com',
            cloudProfileId: 'c_prf_1'
          },
          ttlMs: 3600_000
        },
        t0
      )

      const rawRelayToken = 'relay-token-child'
      const grant = await state.issueRelayGrant(
        {
          rawRelayToken,
          parentSessionId: session.sessionId,
          relayHostId: 'host_child_12345678',
          hostPublicKeyB64: 'key==',
          identity: {
            userId: 'usr_1',
            profileId: 'c_prf_1',
            organizationId: 'org_1'
          },
          ttlMs: 3600_000
        },
        t0
      )

      expect(await state.validateRelayGrantByToken(rawRelayToken, t0 + 100)).not.toBeNull()

      // Explicit revocation by internal sessionId (logout workflow)
      const revoked = await state.revokeAccessSessionById(session.sessionId, t0 + 200)
      expect(revoked).toBe(true)

      expect(await state.lookupAccessSessionByToken('access-for-logout', t0 + 300)).toBeNull()
      expect(await state.validateRelayGrantByToken(rawRelayToken, t0 + 300)).toBeNull()
      expect(
        await state.validateRelayGrantById(grant!.grantId, 'host_child_12345678', t0 + 300)
      ).toBeNull()

      // Explicit revocation by raw access token
      const session2 = await state.issueAccessSession(
        {
          rawAccessToken: 'access-for-token-revoke',
          identity: {
            userId: 'usr_1',
            profileId: 'prf_1',
            organizationId: 'org_1',
            email: 'admin@example.com',
            cloudProfileId: 'c_prf_1'
          },
          ttlMs: 3600_000
        },
        t0 + 400
      )
      expect(session2.sessionId).toBeDefined()
      expect(
        await state.lookupAccessSessionByToken('access-for-token-revoke', t0 + 450)
      ).not.toBeNull()
      const tokenRevoked = await state.revokeAccessSessionByToken(
        'access-for-token-revoke',
        t0 + 500
      )
      expect(tokenRevoked).toBe(true)
      expect(await state.lookupAccessSessionByToken('access-for-token-revoke', t0 + 550)).toBeNull()
    })

    it('revokes relay grant by grantId directly via revokeRelayGrantById', async () => {
      await state.bootstrapAccount({
        email: 'admin@example.com',
        userId: 'usr_1',
        profileId: 'prf_1',
        organizationId: 'org_1',
        passwordRecord
      })

      const t0 = 4_000_000
      const session = await state.issueAccessSession(
        {
          rawAccessToken: 'access-token-for-grant-rev',
          identity: {
            userId: 'usr_1',
            profileId: 'prf_1',
            organizationId: 'org_1',
            email: 'admin@example.com',
            cloudProfileId: 'c_prf_1'
          },
          ttlMs: 3600_000
        },
        t0
      )

      const rawRelayToken = 'relay-token-direct-rev'
      const grant = await state.issueRelayGrant(
        {
          rawRelayToken,
          parentSessionId: session.sessionId,
          relayHostId: 'host_direct_rev_123',
          hostPublicKeyB64: 'key==',
          identity: {
            userId: 'usr_1',
            profileId: 'c_prf_1',
            organizationId: 'org_1'
          },
          ttlMs: 3600_000
        },
        t0
      )

      expect(grant).not.toBeNull()
      expect(
        await state.validateRelayGrantById(grant!.grantId, 'host_direct_rev_123', t0 + 10)
      ).not.toBeNull()

      const revoked = await state.revokeRelayGrantById(grant!.grantId, t0 + 100)
      expect(revoked).toBe(true)

      // Re-revoking returns true (or idempotent)
      const reRevoked = await state.revokeRelayGrantById(grant!.grantId, t0 + 200)
      expect(reRevoked).toBe(true)

      // Invalid now
      expect(
        await state.validateRelayGrantById(grant!.grantId, 'host_direct_rev_123', t0 + 300)
      ).toBeNull()
      expect(await state.validateRelayGrantByToken(rawRelayToken, t0 + 300)).toBeNull()

      // Non-existent grant returns false
      expect(await state.revokeRelayGrantById('non_existent_grant_id', t0 + 400)).toBe(false)
    })
  })
}
