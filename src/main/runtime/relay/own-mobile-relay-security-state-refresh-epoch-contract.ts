import { describe, it, expect, beforeEach } from 'vitest'
import {
  derivePasswordRecord,
  TEST_FAST_PASSWORD_POLICY,
  type PasswordRecord
} from './own-mobile-relay-password'
import type { OwnMobileRelaySecurityState } from './own-mobile-relay-security-state'

export function registerRefreshEpochAndCleanupTests(
  createAdapter: () => Promise<OwnMobileRelaySecurityState> | OwnMobileRelaySecurityState
): void {
  describe('Refresh Epoch and Cleanup Contract', () => {
    let state: OwnMobileRelaySecurityState
    let passwordRecord: PasswordRecord

    beforeEach(async () => {
      state = await createAdapter()
      passwordRecord = await derivePasswordRecord(
        'correct-horse-battery-staple-1234',
        TEST_FAST_PASSWORD_POLICY
      )
    })

    it('returns null on lookupRefreshToken and rotateRefreshToken when account auth_epoch mismatches or account is inactive', async () => {
      const account = await state.bootstrapAccount({
        email: 'admin-refresh-epoch@example.com',
        userId: 'usr_are_1',
        profileId: 'prf_are_1',
        organizationId: 'org_are_1',
        passwordRecord
      })

      const t0 = 2_000_000
      const session = await state.issueAccessSession(
        {
          rawAccessToken: 'access-epoch-test-1',
          identity: {
            userId: account.userId,
            profileId: account.profileId,
            organizationId: account.organizationId,
            email: account.email,
            cloudProfileId: 'c_prf_are_1'
          },
          ttlMs: 3600_000,
          expectedAccountId: account.accountId,
          expectedAuthEpoch: 1
        },
        t0
      )

      await state.issueRefreshToken(
        {
          sessionId: session.sessionId,
          rawRefreshToken: 'refresh-epoch-test-1',
          ttlMs: null
        },
        t0
      )

      expect(await state.lookupRefreshToken('refresh-epoch-test-1', t0 + 1000)).not.toBeNull()

      const newPw = await derivePasswordRecord('new-pw-epoch-bump-1234', TEST_FAST_PASSWORD_POLICY)
      await state.replacePasswordVerifier(account.accountId, {
        expectedVerifierVersion: account.verifierVersion,
        newPasswordRecord: newPw
      })

      expect(await state.lookupRefreshToken('refresh-epoch-test-1', t0 + 3000)).toBeNull()

      const rotateResult = await state.rotateRefreshToken(
        {
          oldRawRefreshToken: 'refresh-epoch-test-1',
          newRawRefreshToken: 'refresh-epoch-test-2',
          newRawAccessToken: 'access-epoch-test-2',
          accessTtlMs: 3600_000,
          refreshTtlMs: null
        },
        t0 + 3000
      )
      expect(rotateResult).toBeNull()
    })

    it('returns null on lookupRefreshToken and rotateRefreshToken when account is disabled', async () => {
      await state.bootstrapAccount({
        email: 'admin-refresh-dis@example.com',
        userId: 'usr_ard_1',
        profileId: 'prf_ard_1',
        organizationId: 'org_ard_1',
        passwordRecord
      })

      const invited = await state.inviteAccount({
        email: 'user-refresh-dis@example.com',
        userId: 'usr_urd_1',
        profileId: 'prf_urd_1',
        organizationId: 'org_ard_1'
      })

      const userPw = await derivePasswordRecord('user-pw-dis-12345678', TEST_FAST_PASSWORD_POLICY)
      await state.activateInvitedAccount(invited.accountId, userPw)

      const t0 = 2_000_000
      await state.disableAccount(invited.accountId, t0)
    })

    it('cleans up session with stale epoch even when live refresh row points to it, deleting both session and refresh row', async () => {
      const account = await state.bootstrapAccount({
        email: 'cleanup-stale-epoch@example.com',
        userId: 'usr_cse_1',
        profileId: 'prf_cse_1',
        organizationId: 'org_cse_1',
        passwordRecord
      })

      const t0 = 4_000_000
      const session = await state.issueAccessSession(
        {
          rawAccessToken: 'access-cse-1',
          identity: {
            userId: account.userId,
            profileId: account.profileId,
            organizationId: account.organizationId,
            email: account.email,
            cloudProfileId: 'c_prf_cse_1'
          },
          ttlMs: 3600_000
        },
        t0
      )

      await state.issueRefreshToken(
        {
          sessionId: session.sessionId,
          rawRefreshToken: 'refresh-cse-1',
          ttlMs: null
        },
        t0
      )

      const newPw = await derivePasswordRecord('new-pw-cse-1234', TEST_FAST_PASSWORD_POLICY)
      await state.replacePasswordVerifier(account.accountId, {
        expectedVerifierVersion: account.verifierVersion,
        newPasswordRecord: newPw
      })

      const cleanupRes = await state.cleanupExpired({ now: t0 + 10_000 })
      expect(cleanupRes.expiredSessionsDeleted).toBe(1)

      expect(await state.lookupAccessSessionByToken('access-cse-1', t0 + 10_000)).toBeNull()
      expect(await state.lookupRefreshToken('refresh-cse-1', t0 + 10_000)).toBeNull()
    })
  })
}
