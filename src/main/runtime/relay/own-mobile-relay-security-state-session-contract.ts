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

      const issued = await state.issueAccessSession(
        {
          rawAccessToken: rawAccess,
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
      expect(session).not.toHaveProperty('refreshToken')
      expect(session).not.toHaveProperty('rawRefreshToken')
      expect(session).not.toHaveProperty('refreshTokenHash')

      const expiredSession = await state.lookupAccessSessionByToken(rawAccess, t0 + ttlMs + 1)
      expect(expiredSession).toBeNull()

      // Atomic durable session replacement keyed by stable sessionId (ephemeral refresh lookup happens in caller)
      const replaced = await state.replaceAccessSession(
        {
          oldSessionId: issued.sessionId,
          newRawAccessToken: 'new-access-token-67890',
          ttlMs
        },
        t0 + 2000
      )
      expect(replaced).not.toBeNull()
      expect(replaced?.sessionId).not.toBe(issued.sessionId)
      expect(replaced?.expiresAt).toBe(t0 + 2000 + ttlMs)
      expect(replaced?.identity.userId).toBe('usr_1')

      // Old access is revoked/replaced
      expect(await state.lookupAccessSessionByToken(rawAccess, t0 + 3000)).toBeNull()
      // New access is valid
      expect(
        await state.lookupAccessSessionByToken('new-access-token-67890', t0 + 3000)
      ).not.toBeNull()
    })

    it('guarded issuance requires matching expected accountId and authEpoch atomically', async () => {
      const account = await state.bootstrapAccount({
        email: 'guarded@example.com',
        userId: 'usr_g1',
        profileId: 'prf_g1',
        organizationId: 'org_g1',
        passwordRecord
      })

      const t0 = 1_500_000
      const ttlMs = 3600_000

      // Mismatched expected accountId fails
      await expect(
        state.issueAccessSession(
          {
            rawAccessToken: 'guarded-token-fail-1',
            identity: {
              userId: 'usr_g1',
              profileId: 'prf_g1',
              organizationId: 'org_g1',
              email: 'guarded@example.com',
              cloudProfileId: 'c_prf_g1'
            },
            ttlMs,
            expectedAccountId: 'wrong-account-id',
            expectedAuthEpoch: account.authEpoch
          },
          t0
        )
      ).rejects.toThrow(/^account_epoch_mismatch$/)

      // Verify no account IDs, epochs, tokens, or hashes leak into the error
      await state
        .issueAccessSession(
          {
            rawAccessToken: 'guarded-token-fail-1-leak-check',
            identity: {
              userId: 'usr_g1',
              profileId: 'prf_g1',
              organizationId: 'org_g1',
              email: 'guarded@example.com',
              cloudProfileId: 'c_prf_g1'
            },
            ttlMs,
            expectedAccountId: 'fixture-secret-account-id-12345',
            expectedAuthEpoch: account.authEpoch
          },
          t0
        )
        .catch((err: Error) => {
          expect(err.message).toBe('account_epoch_mismatch')
          expect(err.message).not.toContain('fixture-secret-account-id-12345')
          expect(err.message).not.toContain(account.accountId)
          expect(err.message).not.toContain(String(account.authEpoch))
          expect(err.message).not.toContain('expected')
          expect(err.message).not.toContain('actual')
        })

      // Mismatched expected authEpoch fails
      await expect(
        state.issueAccessSession(
          {
            rawAccessToken: 'guarded-token-fail-2',
            identity: {
              userId: 'usr_g1',
              profileId: 'prf_g1',
              organizationId: 'org_g1',
              email: 'guarded@example.com',
              cloudProfileId: 'c_prf_g1'
            },
            ttlMs,
            expectedAccountId: account.accountId,
            expectedAuthEpoch: account.authEpoch + 99
          },
          t0
        )
      ).rejects.toThrow(/^account_epoch_mismatch$/)

      // Matching expected accountId and authEpoch succeeds
      const issued = await state.issueAccessSession(
        {
          rawAccessToken: 'guarded-token-success',
          identity: {
            userId: 'usr_g1',
            profileId: 'prf_g1',
            organizationId: 'org_g1',
            email: 'guarded@example.com',
            cloudProfileId: 'c_prf_g1'
          },
          ttlMs,
          expectedAccountId: account.accountId,
          expectedAuthEpoch: account.authEpoch
        },
        t0
      )
      expect(issued.sessionId).toBeDefined()
      expect(issued.authEpoch).toBe(account.authEpoch)
      expect(
        await state.lookupAccessSessionByToken('guarded-token-success', t0 + 100)
      ).not.toBeNull()

      // Concurrent epoch race: If epoch advances, guarded issuance fails
      await state.replacePasswordVerifier({
        expectedVerifierVersion: account.verifierVersion,
        newPasswordRecord: passwordRecord
      })
      await expect(
        state.issueAccessSession(
          {
            rawAccessToken: 'guarded-token-stale-generation',
            identity: {
              userId: 'usr_g1',
              profileId: 'prf_g1',
              organizationId: 'org_g1',
              email: 'guarded@example.com',
              cloudProfileId: 'c_prf_g1'
            },
            ttlMs,
            expectedAccountId: account.accountId,
            expectedAuthEpoch: account.authEpoch // Old epoch!
          },
          t0 + 200
        )
      ).rejects.toThrow(/^account_epoch_mismatch$/)
    })
  })
}
