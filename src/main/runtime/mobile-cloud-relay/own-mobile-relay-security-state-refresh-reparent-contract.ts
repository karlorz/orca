import { describe, it, expect, beforeEach } from 'vitest'
import {
  derivePasswordRecord,
  TEST_FAST_PASSWORD_POLICY,
  type PasswordRecord
} from './own-mobile-relay-password'
import type { OwnMobileRelaySecurityState } from './own-mobile-relay-security-state'

export function registerRefreshGrantReparentTests(
  createAdapter: () => Promise<OwnMobileRelaySecurityState> | OwnMobileRelaySecurityState
): void {
  describe('Refresh grant re-parent contract', () => {
    let state: OwnMobileRelaySecurityState
    let passwordRecord: PasswordRecord

    beforeEach(async () => {
      state = await createAdapter()
      passwordRecord = await derivePasswordRecord(
        'correct-horse-battery-staple-1234',
        TEST_FAST_PASSWORD_POLICY
      )
    })

    it('re-parents unrevoked relay grants across session rotation so grant remains valid and survives old session expiry', async () => {
      const account = await state.bootstrapAccount({
        email: 'reparent-test@example.com',
        userId: 'usr_rp1',
        profileId: 'prf_rp1',
        organizationId: 'org_rp1',
        passwordRecord
      })

      const t0 = 5_000_000
      const accessTtlMs = 3600_000
      const hostId = 'host_rp_12345678'
      const rawAccess1 = 'access-rp-1'
      const rawRefresh1 = 'refresh-rp-1'
      const rawGrant1 = 'grant-rp-1'

      const session1 = await state.issueAccessSession(
        {
          rawAccessToken: rawAccess1,
          identity: {
            userId: account.userId,
            profileId: account.profileId,
            organizationId: account.organizationId,
            email: account.email,
            cloudProfileId: 'c_prf_rp1'
          },
          ttlMs: accessTtlMs
        },
        t0
      )

      await state.issueRefreshToken(
        {
          sessionId: session1.sessionId,
          rawRefreshToken: rawRefresh1,
          ttlMs: null
        },
        t0
      )

      const grant1 = await state.issueRelayGrant(
        {
          rawRelayToken: rawGrant1,
          parentSessionId: session1.sessionId,
          relayHostId: hostId,
          hostPublicKeyB64: 'pk_rp==',
          identity: {
            userId: account.userId,
            profileId: 'c_prf_rp1',
            organizationId: account.organizationId
          },
          ttlMs: 3600_000
        },
        t0
      )
      expect(grant1).not.toBeNull()

      // Grant is initially valid under session1
      const initialGrant = await state.validateRelayGrantById(grant1!.grantId, hostId, t0 + 1000)
      expect(initialGrant).not.toBeNull()
      expect(initialGrant?.parentSessionId).toBe(session1.sessionId)

      // Behavior 1: Rotate refresh token - grant remains valid across parent-session rotation
      const rawAccess2 = 'access-rp-2'
      const rawRefresh2 = 'refresh-rp-2'
      const rotated = await state.rotateRefreshToken(
        {
          oldRawRefreshToken: rawRefresh1,
          newRawRefreshToken: rawRefresh2,
          newRawAccessToken: rawAccess2,
          accessTtlMs,
          refreshTtlMs: null
        },
        t0 + 10_000
      )
      expect(rotated).not.toBeNull()
      expect(rotated?.sessionId).not.toBe(session1.sessionId)

      // validateRelayGrantById after rotate remains valid and reflects the new parentSessionId
      const postRotateGrant = await state.validateRelayGrantById(
        grant1!.grantId,
        hostId,
        t0 + 20_000
      )
      expect(postRotateGrant).not.toBeNull()
      expect(postRotateGrant?.parentSessionId).toBe(rotated!.sessionId)

      // validateRelayGrantByToken also remains valid
      const postRotateGrantByToken = await state.validateRelayGrantByToken(rawGrant1, t0 + 20_000)
      expect(postRotateGrantByToken).not.toBeNull()
      expect(postRotateGrantByToken?.parentSessionId).toBe(rotated!.sessionId)

      // Behavior 2: Grant minted near session expiry does not die solely because old parent session wall-clock hits expiresAt
      // Old session expiresAt was t0 + accessTtlMs = t0 + 3600_000.
      // At t0 + 3600_000 + 1000, old session is past its original expiresAt.
      // But new session expiresAt is t0 + 10_000 + accessTtlMs = t0 + 3610_000.
      const tPastOldSessionExpiry = t0 + 3600_000 + 1000
      const grantPastOldExpiry = await state.validateRelayGrantById(
        grant1!.grantId,
        hostId,
        tPastOldSessionExpiry
      )
      expect(grantPastOldExpiry).not.toBeNull()
      expect(grantPastOldExpiry?.parentSessionId).toBe(rotated!.sessionId)

      // Behavior 3: Logout still makes validateRelayGrantById return null
      // Revoking the new session (logout path) revokes the re-parented grant
      await state.revokeAccessSessionById(rotated!.sessionId, tPastOldSessionExpiry + 500)
      const grantAfterLogout = await state.validateRelayGrantById(
        grant1!.grantId,
        hostId,
        tPastOldSessionExpiry + 1000
      )
      expect(grantAfterLogout).toBeNull()

      const grantByTokenAfterLogout = await state.validateRelayGrantByToken(
        rawGrant1,
        tPastOldSessionExpiry + 1000
      )
      expect(grantByTokenAfterLogout).toBeNull()
    })

    it('does not re-parent already revoked grants during session rotation', async () => {
      const account = await state.bootstrapAccount({
        email: 'reparent-revoked@example.com',
        userId: 'usr_rp2',
        profileId: 'prf_rp2',
        organizationId: 'org_rp2',
        passwordRecord
      })

      const t0 = 6_000_000
      const hostId = 'host_rp_revoked'
      const session = await state.issueAccessSession(
        {
          rawAccessToken: 'access-rp-rev-1',
          identity: {
            userId: account.userId,
            profileId: account.profileId,
            organizationId: account.organizationId,
            email: account.email,
            cloudProfileId: 'c_prf_rp2'
          },
          ttlMs: 3600_000
        },
        t0
      )

      await state.issueRefreshToken(
        {
          sessionId: session.sessionId,
          rawRefreshToken: 'refresh-rp-rev-1',
          ttlMs: null
        },
        t0
      )

      const grant = await state.issueRelayGrant(
        {
          rawRelayToken: 'grant-rp-rev-1',
          parentSessionId: session.sessionId,
          relayHostId: hostId,
          hostPublicKeyB64: 'pk_rp2==',
          identity: {
            userId: account.userId,
            profileId: 'c_prf_rp2',
            organizationId: account.organizationId
          },
          ttlMs: 3600_000
        },
        t0
      )
      expect(grant).not.toBeNull()

      // Revoke the grant prior to session rotation
      await state.revokeRelayGrantById(grant!.grantId, t0 + 100)

      // Rotate session
      await state.rotateRefreshToken(
        {
          oldRawRefreshToken: 'refresh-rp-rev-1',
          newRawRefreshToken: 'refresh-rp-rev-2',
          newRawAccessToken: 'access-rp-rev-2',
          accessTtlMs: 3600_000,
          refreshTtlMs: null
        },
        t0 + 200
      )

      // Revoked grant must remain invalid
      expect(await state.validateRelayGrantById(grant!.grantId, hostId, t0 + 300)).toBeNull()
    })
  })
}
