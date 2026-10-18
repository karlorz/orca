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
      const session = await state.issueAccessSession(
        {
          rawAccessToken: 'access-dis-test-1',
          identity: {
            userId: invited.userId,
            profileId: invited.profileId,
            organizationId: invited.organizationId,
            email: invited.email,
            cloudProfileId: 'c_prf_urd_1'
          },
          ttlMs: 3600_000,
          expectedAccountId: invited.accountId,
          expectedAuthEpoch: invited.authEpoch
        },
        t0
      )

      await state.issueRefreshToken(
        {
          sessionId: session.sessionId,
          rawRefreshToken: 'refresh-dis-test-1',
          ttlMs: null
        },
        t0
      )

      expect(await state.lookupRefreshToken('refresh-dis-test-1', t0 + 1000)).not.toBeNull()

      await state.disableAccount(invited.accountId, t0 + 2000)

      expect(await state.lookupRefreshToken('refresh-dis-test-1', t0 + 3000)).toBeNull()

      const rotateResult = await state.rotateRefreshToken(
        {
          oldRawRefreshToken: 'refresh-dis-test-1',
          newRawRefreshToken: 'refresh-dis-test-2',
          newRawAccessToken: 'access-dis-test-2',
          accessTtlMs: 3600_000,
          refreshTtlMs: null
        },
        t0 + 3000
      )
      expect(rotateResult).toBeNull()
    })

    it('multi-account: refresh token for non-admin user still looks up after admin epoch bump, and fails after user disable or epoch bump', async () => {
      const admin = await state.bootstrapAccount({
        email: 'admin-multi-refresh@example.com',
        userId: 'usr_amr_1',
        profileId: 'prf_amr_1',
        organizationId: 'org_amr_1',
        passwordRecord
      })

      const invited = await state.inviteAccount({
        email: 'user-multi-refresh@example.com',
        userId: 'usr_umr_1',
        profileId: 'prf_umr_1',
        organizationId: 'org_amr_1'
      })

      const userPw = await derivePasswordRecord('user-pw-multi-12345678', TEST_FAST_PASSWORD_POLICY)
      await state.activateInvitedAccount(invited.accountId, userPw)

      const t0 = 3_000_000
      const userSession = await state.issueAccessSession(
        {
          rawAccessToken: 'access-user-multi-1',
          identity: {
            userId: invited.userId,
            profileId: invited.profileId,
            organizationId: invited.organizationId,
            email: invited.email,
            cloudProfileId: 'c_prf_umr_1'
          },
          ttlMs: 3600_000,
          expectedAccountId: invited.accountId,
          expectedAuthEpoch: invited.authEpoch
        },
        t0
      )

      await state.issueRefreshToken(
        {
          sessionId: userSession.sessionId,
          rawRefreshToken: 'refresh-user-multi-1',
          ttlMs: null
        },
        t0
      )

      expect(await state.lookupRefreshToken('refresh-user-multi-1', t0 + 1000)).not.toBeNull()

      // Bump admin epoch by replacing admin password
      const newAdminPw = await derivePasswordRecord(
        'new-admin-pw-multi-1234',
        TEST_FAST_PASSWORD_POLICY
      )
      await state.replacePasswordVerifier(admin.accountId, {
        expectedVerifierVersion: admin.verifierVersion,
        newPasswordRecord: newAdminPw
      })

      // Non-admin user's refresh token must still look up successfully!
      const afterAdminBump = await state.lookupRefreshToken('refresh-user-multi-1', t0 + 2000)
      expect(afterAdminBump).not.toBeNull()
      expect(afterAdminBump?.sessionId).toBe(userSession.sessionId)

      // Bump non-admin user's epoch by replacing their password
      const newUserPw = await derivePasswordRecord(
        'new-user-pw-multi-1234',
        TEST_FAST_PASSWORD_POLICY
      )
      await state.replacePasswordVerifier(invited.accountId, {
        expectedVerifierVersion: invited.verifierVersion,
        newPasswordRecord: newUserPw
      })

      // Now user's refresh token must fail lookup and rotation
      expect(await state.lookupRefreshToken('refresh-user-multi-1', t0 + 3000)).toBeNull()
      const rotateAfterEpochBump = await state.rotateRefreshToken(
        {
          oldRawRefreshToken: 'refresh-user-multi-1',
          newRawRefreshToken: 'refresh-user-multi-2',
          newRawAccessToken: 'access-user-multi-2',
          accessTtlMs: 3600_000,
          refreshTtlMs: null
        },
        t0 + 3000
      )
      expect(rotateAfterEpochBump).toBeNull()
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
