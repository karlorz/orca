import { describe, it, expect, beforeEach } from 'vitest'
import {
  derivePasswordRecord,
  TEST_FAST_PASSWORD_POLICY,
  type PasswordRecord
} from './own-mobile-relay-password'
import type { OwnMobileRelaySecurityState } from './own-mobile-relay-security-state'

export function registerAccountAndVerifierTests(
  createAdapter: () => Promise<OwnMobileRelaySecurityState> | OwnMobileRelaySecurityState
): void {
  describe('Account and Verifier Lifecycle', () => {
    let state: OwnMobileRelaySecurityState
    let passwordRecord: PasswordRecord

    beforeEach(async () => {
      state = await createAdapter()
      passwordRecord = await derivePasswordRecord(
        'correct-horse-battery-staple-1234',
        TEST_FAST_PASSWORD_POLICY
      )
    })

    it('creates one account on bootstrap and rejects a second bootstrap from overwriting it', async () => {
      const initial = await state.bootstrapAccount({
        email: 'admin@example.com',
        userId: 'usr_1',
        profileId: 'prf_1',
        organizationId: 'org_1',
        passwordRecord
      })

      expect(initial.email).toBe('admin@example.com')
      expect(initial.userId).toBe('usr_1')
      expect(initial.profileId).toBe('prf_1')
      expect(initial.organizationId).toBe('org_1')
      expect(initial.verifierVersion).toBe(1)
      expect(initial.authEpoch).toBe(1)
      expect(typeof initial.accountId).toBe('string')
      expect(initial.accountId.length).toBeGreaterThan(0)

      const secondPasswordRecord = await derivePasswordRecord(
        'another-password-must-be-long-1234',
        TEST_FAST_PASSWORD_POLICY
      )

      await expect(
        state.bootstrapAccount({
          email: 'attacker@example.com',
          userId: 'usr_2',
          profileId: 'prf_2',
          organizationId: 'org_2',
          passwordRecord: secondPasswordRecord
        })
      ).rejects.toThrow(/already_initialized|account_exists/i)

      const account = await state.getAccount()
      expect(account?.email).toBe('admin@example.com')
      expect(account?.userId).toBe('usr_1')
    })

    it('returns account identity without exposing password verifiers or salt in ordinary public read', async () => {
      await state.bootstrapAccount({
        email: 'admin@example.com',
        userId: 'usr_1',
        profileId: 'prf_1',
        organizationId: 'org_1',
        passwordRecord
      })

      const account = await state.getAccount()
      expect(account).not.toBeNull()
      expect(account).not.toHaveProperty('passwordRecord')
      expect(account).not.toHaveProperty('verifier')
      expect(account).not.toHaveProperty('salt')
      expect(account).not.toHaveProperty('password')

      const internalRec = await state.getAccountPasswordRecord()
      expect(internalRec).not.toBeNull()
      expect(internalRec?.passwordRecord.verifier).toBe(passwordRecord.verifier)
      expect(internalRec?.passwordRecord.salt).toBe(passwordRecord.salt)
    })

    it('requires expected verifier version, increments verifierVersion and authEpoch atomically', async () => {
      const bootstrap = await state.bootstrapAccount({
        email: 'admin@example.com',
        userId: 'usr_1',
        profileId: 'prf_1',
        organizationId: 'org_1',
        passwordRecord
      })

      const newRecord = await derivePasswordRecord(
        'brand-new-secret-password-1234',
        TEST_FAST_PASSWORD_POLICY
      )

      const badVersionResult = await state.replacePasswordVerifier({
        expectedVerifierVersion: bootstrap.verifierVersion + 99,
        newPasswordRecord: newRecord
      })
      expect(badVersionResult.ok).toBe(false)
      if (!badVersionResult.ok) {
        expect(badVersionResult.error).toBe('version_mismatch')
      }

      const updateResult = await state.replacePasswordVerifier({
        expectedVerifierVersion: bootstrap.verifierVersion,
        newPasswordRecord: newRecord
      })
      expect(updateResult.ok).toBe(true)
      if (updateResult.ok) {
        expect(updateResult.account.verifierVersion).toBe(2)
        expect(updateResult.account.authEpoch).toBe(2)
      }

      const internalRec = await state.getAccountPasswordRecord()
      expect(internalRec?.verifierVersion).toBe(2)
      expect(internalRec?.authEpoch).toBe(2)
      expect(internalRec?.passwordRecord.verifier).toBe(newRecord.verifier)
    })

    it('upgrades verifier version and updatedAt while preserving authEpoch and active session/grant validity', async () => {
      const bootstrap = await state.bootstrapAccount({
        email: 'admin@example.com',
        userId: 'usr_1',
        profileId: 'prf_1',
        organizationId: 'org_1',
        passwordRecord
      })

      const rawAccessToken = 'valid-access-token-123456789'
      const session = await state.issueAccessSession({
        rawAccessToken,
        identity: {
          userId: bootstrap.userId,
          profileId: bootstrap.profileId,
          organizationId: bootstrap.organizationId,
          email: bootstrap.email,
          cloudProfileId: bootstrap.profileId
        },
        ttlMs: 60_000
      })

      const rawRelayToken = 'valid-relay-token-123456789'
      const grant = await state.issueRelayGrant({
        rawRelayToken,
        parentSessionId: session.sessionId,
        relayHostId: 'relay-host-1',
        hostPublicKeyB64: 'host-public-key-b64',
        identity: {
          userId: bootstrap.userId,
          profileId: bootstrap.profileId,
          organizationId: bootstrap.organizationId
        },
        ttlMs: 60_000
      })
      expect(grant).not.toBeNull()

      const upgradedRecord = await derivePasswordRecord(
        'correct-horse-battery-staple-1234',
        TEST_FAST_PASSWORD_POLICY
      )

      const badVersionResult = await state.upgradePasswordVerifier({
        expectedVerifierVersion: bootstrap.verifierVersion + 99,
        newPasswordRecord: upgradedRecord
      })
      expect(badVersionResult.ok).toBe(false)
      if (!badVersionResult.ok) {
        expect(badVersionResult.error).toBe('version_mismatch')
      }

      const upgradeResult = await state.upgradePasswordVerifier({
        expectedVerifierVersion: bootstrap.verifierVersion,
        newPasswordRecord: upgradedRecord
      })
      expect(upgradeResult.ok).toBe(true)
      if (upgradeResult.ok) {
        expect(upgradeResult.account.verifierVersion).toBe(2)
        expect(upgradeResult.account.authEpoch).toBe(1) // Auth epoch preserved!
        expect(upgradeResult.account).not.toHaveProperty('passwordRecord')
      }

      const internalRec = await state.getAccountPasswordRecord()
      expect(internalRec?.verifierVersion).toBe(2)
      expect(internalRec?.authEpoch).toBe(1) // Auth epoch preserved!
      expect(internalRec?.passwordRecord.verifier).toBe(upgradedRecord.verifier)

      // Active session and grant remain valid after policy upgrade
      const validatedSession = await state.lookupAccessSessionByToken(rawAccessToken)
      expect(validatedSession).not.toBeNull()
      expect(validatedSession?.sessionId).toBe(session.sessionId)

      const validatedGrant = await state.validateRelayGrantByToken(rawRelayToken)
      expect(validatedGrant).not.toBeNull()
      expect(validatedGrant?.grantId).toBe(grant?.grantId)
    })
  })
}
