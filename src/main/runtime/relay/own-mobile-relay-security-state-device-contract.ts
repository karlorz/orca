import { describe, it, expect, beforeEach } from 'vitest'
import {
  derivePasswordRecord,
  TEST_FAST_PASSWORD_POLICY,
  type PasswordRecord
} from './own-mobile-relay-password'
import type { OwnMobileRelaySecurityState } from './own-mobile-relay-security-state'
import { RESUME_TOKEN_TTL_MS, GRACE_TOKEN_TTL_MS } from './own-mobile-relay-types'

export function registerDeviceAndEpochTests(
  createAdapter: () => Promise<OwnMobileRelaySecurityState> | OwnMobileRelaySecurityState
): void {
  describe('Device and Epoch Lifecycle', () => {
    let state: OwnMobileRelaySecurityState
    let passwordRecord: PasswordRecord

    beforeEach(async () => {
      state = await createAdapter()
      passwordRecord = await derivePasswordRecord(
        'correct-horse-battery-staple-1234',
        TEST_FAST_PASSWORD_POLICY
      )
    })

    it('invalidates all active sessions and grants on epoch bump while keeping device credentials intact', async () => {
      const bootstrap = await state.bootstrapAccount({
        email: 'admin@example.com',
        userId: 'usr_1',
        profileId: 'prf_1',
        organizationId: 'org_1',
        passwordRecord
      })

      const t0 = 4_000_000
      const session = await state.issueAccessSession(
        {
          rawAccessToken: 'access-epoch-test',
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

      const rawRelayToken = 'relay-epoch-test'
      await state.issueRelayGrant(
        {
          rawRelayToken,
          parentSessionId: session.sessionId,
          relayHostId: 'host_epoch_12345678',
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

      const deviceHash = 'a'.repeat(43)
      const deviceInstall = await state.installDeviceCredential(
        {
          relayHostId: 'host_epoch_12345678',
          relayDeviceId: 'dev_1234',
          reqId: 'req_install_1',
          newResumeTokenHash: deviceHash,
          authorizationMode: 'relay-basis'
        },
        t0
      )
      expect(deviceInstall.ok).toBe(true)

      const newPassword = await derivePasswordRecord(
        'new-long-password-12345678',
        TEST_FAST_PASSWORD_POLICY
      )
      await state.replacePasswordVerifier(
        {
          expectedVerifierVersion: bootstrap.verifierVersion,
          newPasswordRecord: newPassword
        },
        t0 + 1000
      )

      expect(await state.lookupAccessSessionByToken('access-epoch-test', t0 + 2000)).toBeNull()
      expect(await state.validateRelayGrantByToken(rawRelayToken, t0 + 2000)).toBeNull()

      const match = await state.matchDeviceCredential('host_epoch_12345678', deviceHash, t0 + 2000)
      expect(match).not.toBeNull()
      expect(match?.device.relayDeviceId).toBe('dev_1234')
    })

    it('enforces exact hash matching without re-hashing, handles current-to-grace rotation and expiry', async () => {
      const t0 = 5_000_000
      const hostId = 'host_dev_12345678'
      const devId = 'dev_mobile_1234'
      const initialHash = '1'.repeat(43)

      const res1 = await state.installDeviceCredential(
        {
          relayHostId: hostId,
          relayDeviceId: devId,
          reqId: 'req_1',
          newResumeTokenHash: initialHash,
          authorizationMode: 'relay-basis'
        },
        t0
      )
      expect(res1.ok).toBe(true)
      if (res1.ok) {
        expect(res1.installed.currentVersion).toBe(1)
        expect(res1.installed.resumeExpiresAt).toBe(t0 + RESUME_TOKEN_TTL_MS)
        expect(res1.installed.graceExpiresAt).toBeUndefined()
      }

      const status1 = await state.getDeviceCredentialInstallStatus(hostId, devId, 'req_1')
      expect(status1.state).toBe('committed')
      if (status1.state === 'committed') {
        expect(status1.result.reqId).toBe('req_1')
        expect(status1.result.currentVersion).toBe(1)
      }

      const badHash = '2'.repeat(43)
      const mismatchRes = await state.installDeviceCredential(
        {
          relayHostId: hostId,
          relayDeviceId: devId,
          reqId: 'req_2_mismatch',
          newResumeTokenHash: badHash,
          expectedCurrentHash: 'wrong_current_hash__________________________',
          authorizationMode: 'relay-basis'
        },
        t0 + 1000
      )
      expect(mismatchRes.ok).toBe(false)
      if (!mismatchRes.ok) {
        expect(mismatchRes.code).toBe('hash-mismatch')
      }

      const rotatedHash = '3'.repeat(43)
      const rotRes = await state.installDeviceCredential(
        {
          relayHostId: hostId,
          relayDeviceId: devId,
          reqId: 'req_3_rotate',
          newResumeTokenHash: rotatedHash,
          expectedCurrentHash: initialHash,
          authorizationMode: 'relay-basis'
        },
        t0 + 2000
      )
      expect(rotRes.ok).toBe(true)
      if (rotRes.ok) {
        expect(rotRes.installed.currentVersion).toBe(2)
        expect(rotRes.installed.graceExpiresAt).toBe(t0 + 2000 + GRACE_TOKEN_TTL_MS)
      }

      const matchCurrent = await state.matchDeviceCredential(hostId, rotatedHash, t0 + 2500)
      expect(matchCurrent).not.toBeNull()
      expect(matchCurrent?.acceptedAs).toBe('current')

      const matchGrace = await state.matchDeviceCredential(hostId, initialHash, t0 + 2500)
      expect(matchGrace).not.toBeNull()
      expect(matchGrace?.acceptedAs).toBe('grace')

      const matchGraceExpired = await state.matchDeviceCredential(
        hostId,
        initialHash,
        t0 + 2000 + GRACE_TOKEN_TTL_MS + 1
      )
      expect(matchGraceExpired).toBeNull()

      const revoked = await state.revokeDeviceCredential(hostId, devId, t0 + 3000)
      expect(revoked).toBe(true)

      expect(await state.matchDeviceCredential(hostId, rotatedHash, t0 + 3500)).toBeNull()
    })

    it('caps total deletions across sessions, grants, and devices globally in cleanupExpired', async () => {
      await state.bootstrapAccount({
        email: 'admin@example.com',
        userId: 'usr_1',
        profileId: 'prf_1',
        organizationId: 'org_1',
        passwordRecord
      })

      const t0 = 6_000_000
      // Create 3 expired sessions
      for (let i = 0; i < 3; i++) {
        await state.issueAccessSession(
          {
            rawAccessToken: `expired-access-${i}`,
            identity: {
              userId: 'usr_1',
              profileId: 'prf_1',
              organizationId: 'org_1',
              email: 'admin@example.com',
              cloudProfileId: 'c_prf_1'
            },
            ttlMs: 1000
          },
          t0
        )
      }

      // Create 3 expired devices
      for (let i = 0; i < 3; i++) {
        await state.installDeviceCredential(
          {
            relayHostId: `host_cleanup_${i}`,
            relayDeviceId: `dev_cleanup_${i}`,
            reqId: `req_cleanup_${i}`,
            newResumeTokenHash: `${i}`.repeat(43),
            authorizationMode: 'relay-basis',
            resumeTtlMs: 1000,
            graceTtlMs: 1000
          },
          t0
        )
      }

      const queryTime = t0 + 2000

      expect(await state.lookupAccessSessionByToken('expired-access-0', queryTime)).toBeNull()

      // Global cap test: maxBatchSize = 2 across ALL entities total
      const cleanup1 = await state.cleanupExpired({ maxBatchSize: 2, now: queryTime })
      const totalDeleted1 =
        cleanup1.expiredSessionsDeleted +
        cleanup1.expiredGrantsDeleted +
        cleanup1.expiredDevicesDeleted
      expect(totalDeleted1).toBe(2)

      // Next batch cleanup deletes remaining expired entries up to global maxBatchSize
      const cleanup2 = await state.cleanupExpired({ maxBatchSize: 10, now: queryTime })
      const totalDeleted2 =
        cleanup2.expiredSessionsDeleted +
        cleanup2.expiredGrantsDeleted +
        cleanup2.expiredDevicesDeleted
      expect(totalDeleted2).toBe(4) // 3 + 3 = 6 total expired, 2 deleted in first pass, 4 in second
    })

    it('rejects subsequent operations consistently once closed', async () => {
      await state.bootstrapAccount({
        email: 'admin@example.com',
        userId: 'usr_1',
        profileId: 'prf_1',
        organizationId: 'org_1',
        passwordRecord
      })

      await state.close()

      await expect(state.getAccount()).rejects.toThrow(/closed/i)
      await expect(
        state.issueAccessSession({
          rawAccessToken: 'acc',
          identity: {
            userId: 'u',
            profileId: 'p',
            organizationId: 'o',
            email: 'e',
            cloudProfileId: 'cp'
          },
          ttlMs: 1000
        })
      ).rejects.toThrow(/closed/i)
    })
  })
}
