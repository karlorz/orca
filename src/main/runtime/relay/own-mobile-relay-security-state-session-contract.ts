import { describe, it, expect, beforeEach } from 'vitest'
import {
  derivePasswordRecord,
  TEST_FAST_PASSWORD_POLICY,
  type PasswordRecord
} from './own-mobile-relay-password'
import type { OwnMobileRelaySecurityState } from './own-mobile-relay-security-state'

export function registerSessionAndGrantTests(
  createAdapter: () => Promise<OwnMobileRelaySecurityState> | OwnMobileRelaySecurityState
): void {
  describe('Session and Grant Lifecycle', () => {
    let state: OwnMobileRelaySecurityState
    let passwordRecord: PasswordRecord

    beforeEach(async () => {
      state = await createAdapter()
      passwordRecord = await derivePasswordRecord(
        'correct-horse-battery-staple-1234',
        TEST_FAST_PASSWORD_POLICY
      )
    })

    it('handles session lifecycle, token lookup by hash, deterministic expiry, and stale epoch rejection', async () => {
      await state.bootstrapAccount({
        email: 'admin@example.com',
        userId: 'usr_1',
        profileId: 'prf_1',
        organizationId: 'org_1',
        passwordRecord
      })

      const t0 = 1_000_000
      const ttlMs = 3600_000
      const rawAccess = 'raw-access-token-xyz-12345'
      const rawRefresh = 'raw-refresh-token-xyz-12345'

      const issued = await state.issueAccessSession(
        {
          rawAccessToken: rawAccess,
          rawRefreshToken: rawRefresh,
          identity: {
            userId: 'usr_1',
            profileId: 'prf_1',
            organizationId: 'org_1',
            email: 'admin@example.com',
            cloudProfileId: 'c_prf_1'
          },
          ttlMs
        },
        t0
      )

      expect(issued.authEpoch).toBe(1)
      expect(issued.expiresAt).toBe(t0 + ttlMs)

      const session = await state.lookupAccessSessionByToken(rawAccess, t0 + 1000)
      expect(session).not.toBeNull()
      expect(session?.sessionId).toBe(issued.sessionId)
      expect(session).not.toHaveProperty('rawAccessToken')
      expect(session).not.toHaveProperty('accessTokenHash')

      const expiredSession = await state.lookupAccessSessionByToken(rawAccess, t0 + ttlMs + 1)
      expect(expiredSession).toBeNull()

      const refreshLookup = await state.lookupAccessSessionByRefreshToken(rawRefresh, t0 + 1000)
      expect(refreshLookup?.sessionId).toBe(issued.sessionId)

      const rotated = await state.rotateAccessSession(
        {
          rawRefreshToken: rawRefresh,
          newRawAccessToken: 'new-access-token-67890',
          newRawRefreshToken: 'new-refresh-token-67890',
          ttlMs
        },
        t0 + 2000
      )
      expect(rotated).not.toBeNull()
      expect(rotated?.expiresAt).toBe(t0 + 2000 + ttlMs)

      expect(await state.lookupAccessSessionByToken(rawAccess, t0 + 3000)).toBeNull()
      expect(await state.lookupAccessSessionByRefreshToken(rawRefresh, t0 + 3000)).toBeNull()
      expect(
        await state.lookupAccessSessionByToken('new-access-token-67890', t0 + 3000)
      ).not.toBeNull()
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
          rawRefreshToken: 'refresh-token-1',
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
          rawRefreshToken: 'refresh-for-logout',
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

      const revoked = await state.revokeAccessSession(session.sessionId, t0 + 200)
      expect(revoked).toBe(true)

      expect(await state.lookupAccessSessionByToken('access-for-logout', t0 + 300)).toBeNull()
      expect(await state.validateRelayGrantByToken(rawRelayToken, t0 + 300)).toBeNull()
      expect(
        await state.validateRelayGrantById(grant!.grantId, 'host_child_12345678', t0 + 300)
      ).toBeNull()
    })
  })
}
