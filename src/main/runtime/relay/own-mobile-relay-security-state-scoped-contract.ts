import { describe, it, expect, beforeEach } from 'vitest'
import {
  derivePasswordRecord,
  TEST_FAST_PASSWORD_POLICY,
  type PasswordRecord
} from './own-mobile-relay-password'
import type { OwnMobileRelaySecurityState } from './own-mobile-relay-security-state'

export function registerAccountScopedStoreTests(
  createAdapter: () => Promise<OwnMobileRelaySecurityState> | OwnMobileRelaySecurityState
): void {
  describe('Account-Scoped Multi-User Operations', () => {
    let state: OwnMobileRelaySecurityState
    let adminPasswordRecord: PasswordRecord
    let userPasswordRecord: PasswordRecord

    beforeEach(async () => {
      state = await createAdapter()
      adminPasswordRecord = await derivePasswordRecord(
        'admin-password-12345678',
        TEST_FAST_PASSWORD_POLICY
      )
      userPasswordRecord = await derivePasswordRecord(
        'user-password-12345678',
        TEST_FAST_PASSWORD_POLICY
      )
    })

    it('invites a user account with role=user, status=invited, and credentials null', async () => {
      const admin = await state.bootstrapAccount({
        email: 'admin@example.com',
        userId: 'usr_admin',
        profileId: 'prf_admin',
        organizationId: 'org_main',
        passwordRecord: adminPasswordRecord
      })
      expect(admin.role).toBe('admin')
      expect(admin.status).toBe('active')

      const invited = await state.inviteAccount({
        email: 'Invited.User@Example.Com',
        userId: 'usr_invited_1',
        profileId: 'prf_invited_1',
        organizationId: 'org_main'
      })

      expect(invited.role).toBe('user')
      expect(invited.status).toBe('invited')
      expect(invited.email).toBe('invited.user@example.com')
      expect(invited.verifierVersion).toBe(1)
      expect(invited.authEpoch).toBe(1)

      const pwRec = await state.getAccountPasswordRecord(invited.accountId)
      expect(pwRec).toBeNull()

      // Lowercase unique email constraint: duplicate invite with different casing throws
      await expect(
        state.inviteAccount({
          email: 'invited.user@example.com',
          userId: 'usr_diff_1',
          profileId: 'prf_diff_1',
          organizationId: 'org_main'
        })
      ).rejects.toThrow()
    })

    it('activates an invited account, writing credentials without bumping auth_epoch', async () => {
      await state.bootstrapAccount({
        email: 'admin@example.com',
        userId: 'usr_admin',
        profileId: 'prf_admin',
        organizationId: 'org_main',
        passwordRecord: adminPasswordRecord
      })

      const invited = await state.inviteAccount({
        email: 'member@example.com',
        userId: 'usr_member',
        profileId: 'prf_member',
        organizationId: 'org_main'
      })

      const activateRes = await state.activateInvitedAccount(invited.accountId, userPasswordRecord)
      expect(activateRes).toBe('ok')

      const pwRec = await state.getAccountPasswordRecord(invited.accountId)
      expect(pwRec).not.toBeNull()
      expect(pwRec?.verifierVersion).toBe(1)
      expect(pwRec?.authEpoch).toBe(1)
      expect(pwRec?.passwordRecord.verifier).toBe(userPasswordRecord.verifier)
    })

    it('returns conflict on delayed/duplicate activate of an already-active row without overwriting credentials or epoch', async () => {
      await state.bootstrapAccount({
        email: 'admin@example.com',
        userId: 'usr_admin',
        profileId: 'prf_admin',
        organizationId: 'org_main',
        passwordRecord: adminPasswordRecord
      })

      const invited = await state.inviteAccount({
        email: 'conflict@example.com',
        userId: 'usr_conflict',
        profileId: 'prf_conflict',
        organizationId: 'org_main'
      })

      expect(await state.activateInvitedAccount(invited.accountId, userPasswordRecord)).toBe('ok')

      const secondPasswordRecord = await derivePasswordRecord(
        'attacker-attempt-overwrite-1234',
        TEST_FAST_PASSWORD_POLICY
      )

      // Duplicate activate returns 'conflict'
      const conflictRes = await state.activateInvitedAccount(
        invited.accountId,
        secondPasswordRecord
      )
      expect(conflictRes).toBe('conflict')

      // Credentials and epoch must not be changed
      const pwRec = await state.getAccountPasswordRecord(invited.accountId)
      expect(pwRec?.authEpoch).toBe(1)
      expect(pwRec?.verifierVersion).toBe(1)
      expect(pwRec?.passwordRecord.verifier).toBe(userPasswordRecord.verifier)
    })

    it('rejects replacePasswordVerifier and upgradePasswordVerifier on non-active accounts', async () => {
      await state.bootstrapAccount({
        email: 'admin@example.com',
        userId: 'usr_admin',
        profileId: 'prf_admin',
        organizationId: 'org_main',
        passwordRecord: adminPasswordRecord
      })

      const invited = await state.inviteAccount({
        email: 'pending@example.com',
        userId: 'usr_pending',
        profileId: 'prf_pending',
        organizationId: 'org_main'
      })

      const newPw = await derivePasswordRecord('new-pw-12345678', TEST_FAST_PASSWORD_POLICY)

      // Invited account is not active -> replace returns error 'not_active'
      const replaceInvited = await state.replacePasswordVerifier(invited.accountId, {
        expectedVerifierVersion: 1,
        newPasswordRecord: newPw
      })
      expect(replaceInvited).toEqual({ ok: false, error: 'not_active' })

      const upgradeInvited = await state.upgradePasswordVerifier(invited.accountId, {
        expectedVerifierVersion: 1,
        newPasswordRecord: newPw
      })
      expect(upgradeInvited).toEqual({ ok: false, error: 'not_active' })

      // Unknown account -> error 'not_found'
      const replaceNotFound = await state.replacePasswordVerifier('unknown_acc_id', {
        expectedVerifierVersion: 1,
        newPasswordRecord: newPw
      })
      expect(replaceNotFound).toEqual({ ok: false, error: 'not_found' })
    })

    it('disabling the last remaining admin returns last_admin and does not change the row', async () => {
      const admin = await state.bootstrapAccount({
        email: 'sole-admin@example.com',
        userId: 'usr_admin',
        profileId: 'prf_admin',
        organizationId: 'org_main',
        passwordRecord: adminPasswordRecord
      })

      const disableRes = await state.disableAccount(admin.accountId)
      expect(disableRes).toBe('last_admin')

      // Admin remains active with intact epoch
      const adminCheck = await state.getAccount()
      expect(adminCheck?.status).toBe('active')
      expect(adminCheck?.authEpoch).toBe(1)
    })

    it('disabling a non-admin user succeeds, sets status=disabled, bumps auth_epoch, and rejects replace', async () => {
      await state.bootstrapAccount({
        email: 'admin@example.com',
        userId: 'usr_admin',
        profileId: 'prf_admin',
        organizationId: 'org_main',
        passwordRecord: adminPasswordRecord
      })

      const invited = await state.inviteAccount({
        email: 'user-to-disable@example.com',
        userId: 'usr_disable_me',
        profileId: 'prf_disable_me',
        organizationId: 'org_main'
      })

      await state.activateInvitedAccount(invited.accountId, userPasswordRecord)

      const disableRes = await state.disableAccount(invited.accountId)
      expect(disableRes).toBe('ok')

      const disabledPwRec = await state.getAccountPasswordRecord(invited.accountId)
      expect(disabledPwRec?.authEpoch).toBe(2) // auth_epoch bumped!

      const newPw = await derivePasswordRecord('new-pwd-after-disable', TEST_FAST_PASSWORD_POLICY)
      const replaceDisabled = await state.replacePasswordVerifier(invited.accountId, {
        expectedVerifierVersion: 1,
        newPasswordRecord: newPw
      })
      expect(replaceDisabled).toEqual({ ok: false, error: 'not_active' })
    })
  })
}
