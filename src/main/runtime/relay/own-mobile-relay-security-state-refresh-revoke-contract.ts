import { describe, it, expect, beforeEach } from 'vitest'
import {
  derivePasswordRecord,
  TEST_FAST_PASSWORD_POLICY,
  type PasswordRecord
} from './own-mobile-relay-password'
import type { OwnMobileRelaySecurityState } from './own-mobile-relay-security-state'

export function registerRefreshRevokeAndKeyExpiryTests(
  createAdapter: () => Promise<OwnMobileRelaySecurityState> | OwnMobileRelaySecurityState
): void {
  describe('Refresh revoke and key expiry contract', () => {
    let state: OwnMobileRelaySecurityState
    let passwordRecord: PasswordRecord

    beforeEach(async () => {
      state = await createAdapter()
      passwordRecord = await derivePasswordRecord(
        'correct-horse-battery-staple-1234',
        TEST_FAST_PASSWORD_POLICY
      )
    })

    it('revokes refresh tokens when revoking session or on auth epoch bump', async () => {
      const account = await state.bootstrapAccount({
        email: 'epoch-refresh@example.com',
        userId: 'usr_er1',
        profileId: 'prf_er1',
        organizationId: 'org_er1',
        passwordRecord
      })

      const t0 = 2_000_000
      const session = await state.issueAccessSession(
        {
          rawAccessToken: 'access-er-1',
          identity: {
            userId: account.userId,
            profileId: account.profileId,
            organizationId: account.organizationId,
            email: account.email,
            cloudProfileId: 'c_prf_er1'
          },
          ttlMs: 3600_000
        },
        t0
      )

      await state.issueRefreshToken(
        {
          sessionId: session.sessionId,
          rawRefreshToken: 'refresh-er-1',
          ttlMs: null
        },
        t0
      )

      expect(await state.lookupRefreshToken('refresh-er-1', t0 + 1000)).not.toBeNull()

      // Explicit revoke by session ID
      await state.revokeRefreshTokensForSession(session.sessionId, t0 + 2000)
      expect(await state.lookupRefreshToken('refresh-er-1', t0 + 3000)).toBeNull()

      // Issue another session and refresh token
      const session2 = await state.issueAccessSession(
        {
          rawAccessToken: 'access-er-2',
          identity: {
            userId: account.userId,
            profileId: account.profileId,
            organizationId: account.organizationId,
            email: account.email,
            cloudProfileId: 'c_prf_er1'
          },
          ttlMs: 3600_000
        },
        t0 + 4000
      )

      await state.issueRefreshToken(
        {
          sessionId: session2.sessionId,
          rawRefreshToken: 'refresh-er-2',
          ttlMs: null
        },
        t0 + 4000
      )
      expect(await state.lookupRefreshToken('refresh-er-2', t0 + 5000)).not.toBeNull()

      // Password replacement bumps epoch and revokes all refresh tokens
      const newPasswordRecord = await derivePasswordRecord(
        'new-password-1234',
        TEST_FAST_PASSWORD_POLICY
      )
      await state.replacePasswordVerifier({
        expectedVerifierVersion: account.verifierVersion,
        newPasswordRecord
      })

      expect(await state.lookupRefreshToken('refresh-er-2', t0 + 6000)).toBeNull()
    })

    it('manages key expiry for host and device with default keyExpiryDisabled=true', async () => {
      const account = await state.bootstrapAccount({
        email: 'key-expiry@example.com',
        userId: 'usr_ke1',
        profileId: 'prf_ke1',
        organizationId: 'org_ke1',
        passwordRecord
      })

      const t0 = 3_000_000
      const hostId = 'host_ke_12345678'
      const deviceId = 'dev_ke_1'

      // Default: host key expiry is disabled (true)
      expect(await state.isHostKeyExpiryDisabled(hostId)).toBe(true)
      expect(await state.isDeviceKeyExpiryDisabled(hostId, deviceId)).toBe(true)

      // Install device with explicit key expiry enabled (disabled=false)
      const devHashEnabled = 'e'.repeat(43)
      await state.installDeviceCredential(
        {
          relayHostId: hostId,
          relayDeviceId: 'dev_ke_enabled',
          reqId: 'req_ke_enabled',
          newResumeTokenHash: devHashEnabled,
          authorizationMode: 'relay-basis',
          resumeTtlMs: 1000 // 1 second
        },
        t0
      )
      await state.setDeviceKeyExpiryDisabled(hostId, 'dev_ke_enabled', false)
      expect(await state.matchDeviceCredential(hostId, devHashEnabled, t0 + 5000)).toBeNull()

      // Install device with key expiry disabled (default)
      const devHash = 'k'.repeat(43)
      await state.installDeviceCredential(
        {
          relayHostId: hostId,
          relayDeviceId: deviceId,
          reqId: 'req_ke_1',
          newResumeTokenHash: devHash,
          authorizationMode: 'relay-basis',
          resumeTtlMs: 1000 // 1 second
        },
        t0
      )

      // Match device past 1s TTL: succeeds because keyExpiryDisabled=true
      const matchPastExpiry = await state.matchDeviceCredential(hostId, devHash, t0 + 5000)
      expect(matchPastExpiry).not.toBeNull()

      // Issue session and grant (grant with 1s TTL)
      const session = await state.issueAccessSession(
        {
          rawAccessToken: 'access-ke-1',
          identity: {
            userId: account.userId,
            profileId: account.profileId,
            organizationId: account.organizationId,
            email: account.email,
            cloudProfileId: 'c_prf_ke1'
          },
          ttlMs: 3600_000
        },
        t0
      )

      const rawGrantToken = 'grant-token-ke-1'
      const grant = await state.issueRelayGrant(
        {
          rawRelayToken: rawGrantToken,
          parentSessionId: session.sessionId,
          relayHostId: hostId,
          hostPublicKeyB64: 'pk_ke==',
          identity: {
            userId: account.userId,
            profileId: 'c_prf_ke1',
            organizationId: account.organizationId
          },
          ttlMs: 1000 // 1s TTL
        },
        t0
      )
      expect(grant).not.toBeNull()

      // Grant past 1s TTL is valid because host key expiry is disabled (parent session is still valid within 1h)
      const grantValidPastExpiry = await state.validateRelayGrantById(
        grant!.grantId,
        hostId,
        t0 + 5000
      )
      expect(grantValidPastExpiry).not.toBeNull()

      const grantByTokenPastExpiry = await state.validateRelayGrantByToken(rawGrantToken, t0 + 5000)
      expect(grantByTokenPastExpiry).not.toBeNull()

      // Now enable key expiry for host (disabled = false)
      await state.setHostKeyExpiryDisabled(hostId, false)
      expect(await state.isHostKeyExpiryDisabled(hostId)).toBe(false)

      // Now grant past 1s TTL fails because host key expiry is enabled
      const grantExpired = await state.validateRelayGrantById(grant!.grantId, hostId, t0 + 5000)
      expect(grantExpired).toBeNull()

      // Now enable key expiry for device (disabled = false)
      await state.setDeviceKeyExpiryDisabled(hostId, deviceId, false)
      expect(await state.isDeviceKeyExpiryDisabled(hostId, deviceId)).toBe(false)

      // Device past 1s TTL fails
      const devExpired = await state.matchDeviceCredential(hostId, devHash, t0 + 5000)
      expect(devExpired).toBeNull()
    })
  })
}
