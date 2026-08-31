import { describe, it, expect, beforeEach } from 'vitest'
import {
  derivePasswordRecord,
  TEST_FAST_PASSWORD_POLICY,
  type PasswordRecord
} from './own-mobile-relay-password'
import type { OwnMobileRelaySecurityState } from './own-mobile-relay-security-state'

export function registerRefreshTokenAndKeyExpiryTests(
  createAdapter: () => Promise<OwnMobileRelaySecurityState> | OwnMobileRelaySecurityState
): void {
  describe('Refresh Token & Key Expiry Contract', () => {
    let state: OwnMobileRelaySecurityState
    let passwordRecord: PasswordRecord

    beforeEach(async () => {
      state = await createAdapter()
      passwordRecord = await derivePasswordRecord(
        'correct-horse-battery-staple-1234',
        TEST_FAST_PASSWORD_POLICY
      )
    })

    it('issues, looks up, and rotates refresh tokens with hashed persistence', async () => {
      const account = await state.bootstrapAccount({
        email: 'refresh-test@example.com',
        userId: 'usr_r1',
        profileId: 'prf_r1',
        organizationId: 'org_r1',
        passwordRecord
      })

      const t0 = 1_000_000
      const accessTtlMs = 3600_000
      const rawAccess = 'raw-access-1'
      const rawRefresh = 'raw-refresh-1'

      const session = await state.issueAccessSession(
        {
          rawAccessToken: rawAccess,
          identity: {
            userId: account.userId,
            profileId: account.profileId,
            organizationId: account.organizationId,
            email: account.email,
            cloudProfileId: 'c_prf_r1'
          },
          ttlMs: accessTtlMs
        },
        t0
      )

      // Issue refresh token with null TTL (key expiry disabled / infinite)
      await state.issueRefreshToken(
        {
          sessionId: session.sessionId,
          rawRefreshToken: rawRefresh,
          ttlMs: null
        },
        t0
      )

      // Lookup refresh token by raw token
      const lookedUp = await state.lookupRefreshToken(rawRefresh, t0 + 10_000)
      expect(lookedUp).not.toBeNull()
      expect(lookedUp?.sessionId).toBe(session.sessionId)
      expect(lookedUp?.cloudProfileId).toBe('c_prf_r1')
      expect(lookedUp?.expiresAt).toBeNull()
      expect(lookedUp).not.toHaveProperty('rawRefreshToken')
      expect(lookedUp).not.toHaveProperty('tokenHash')
      expect(lookedUp).not.toHaveProperty('refreshTokenHash')

      // Rotate refresh token atomically (rotates access session + refresh token)
      const newRawAccess = 'raw-access-2'
      const newRawRefresh = 'raw-refresh-2'
      const rotated = await state.rotateRefreshToken(
        {
          oldRawRefreshToken: rawRefresh,
          newRawRefreshToken: newRawRefresh,
          newRawAccessToken: newRawAccess,
          accessTtlMs,
          refreshTtlMs: null
        },
        t0 + 20_000
      )

      expect(rotated).not.toBeNull()
      expect(rotated?.sessionId).not.toBe(session.sessionId)
      expect(rotated?.expiresAt).toBe(t0 + 20_000 + accessTtlMs)
      expect(rotated?.identity.userId).toBe(account.userId)
      expect(rotated?.identity.cloudProfileId).toBe('c_prf_r1')

      // Old refresh token is revoked / unusable
      expect(await state.lookupRefreshToken(rawRefresh, t0 + 30_000)).toBeNull()
      // Old access session is revoked
      expect(await state.lookupAccessSessionByToken(rawAccess, t0 + 30_000)).toBeNull()

      // New refresh token is active
      const lookedUpNew = await state.lookupRefreshToken(newRawRefresh, t0 + 30_000)
      expect(lookedUpNew).not.toBeNull()
      expect(lookedUpNew?.sessionId).toBe(rotated?.sessionId)

      // New access token is active
      const lookedUpNewAccess = await state.lookupAccessSessionByToken(newRawAccess, t0 + 30_000)
      expect(lookedUpNewAccess).not.toBeNull()
      expect(lookedUpNewAccess?.sessionId).toBe(rotated?.sessionId)
    })

    it('allows lookup and rotation of refresh token after access session has expired', async () => {
      const account = await state.bootstrapAccount({
        email: 'durable-after-access-expired@example.com',
        userId: 'usr_dur_exp',
        profileId: 'prf_dur_exp',
        organizationId: 'org_dur_exp',
        passwordRecord
      })

      const t0 = 1_000_000
      const accessTtlMs = 1000 // 1 second access session
      const rawAccess = 'access-short-lived'
      const rawRefresh = 'refresh-durable-null-ttl'

      const session = await state.issueAccessSession(
        {
          rawAccessToken: rawAccess,
          identity: {
            userId: account.userId,
            profileId: account.profileId,
            organizationId: account.organizationId,
            email: account.email,
            cloudProfileId: 'c_prf_dur_exp'
          },
          ttlMs: accessTtlMs
        },
        t0
      )

      await state.issueRefreshToken(
        {
          sessionId: session.sessionId,
          rawRefreshToken: rawRefresh,
          ttlMs: null // key expiry disabled
        },
        t0
      )

      const tCheck = t0 + 5000 // 5 seconds later (access session expired at t0+1000)

      // Access session is expired
      expect(await state.lookupAccessSessionByToken(rawAccess, tCheck)).toBeNull()

      // Refresh token lookup still succeeds!
      const lookedUp = await state.lookupRefreshToken(rawRefresh, tCheck)
      expect(lookedUp).not.toBeNull()
      expect(lookedUp?.sessionId).toBe(session.sessionId)
      expect(lookedUp?.cloudProfileId).toBe('c_prf_dur_exp')

      // Refresh token rotation succeeds and mints a new fresh access session!
      const newRawAccess = 'access-re-minted'
      const newRawRefresh = 'refresh-re-minted'
      const rotated = await state.rotateRefreshToken(
        {
          oldRawRefreshToken: rawRefresh,
          newRawRefreshToken: newRawRefresh,
          newRawAccessToken: newRawAccess,
          accessTtlMs: 3600_000,
          refreshTtlMs: null
        },
        tCheck
      )

      expect(rotated).not.toBeNull()
      expect(rotated?.expiresAt).toBe(tCheck + 3600_000)
      expect(await state.lookupAccessSessionByToken(newRawAccess, tCheck + 100)).not.toBeNull()
      expect(await state.lookupRefreshToken(rawRefresh, tCheck + 100)).toBeNull()
      expect(await state.lookupRefreshToken(newRawRefresh, tCheck + 100)).not.toBeNull()
    })

    it('enabling host key expiry revokes that host refresh tokens to force PKCE reauth', async () => {
      const account = await state.bootstrapAccount({
        email: 'enable-expiry-forces-reauth@example.com',
        userId: 'usr_eefr',
        profileId: 'prf_eefr',
        organizationId: 'org_eefr',
        passwordRecord
      })

      const t0 = 1_500_000
      const hostId = 'host_reauth_test'
      const rawAccess = 'access-reauth-1'
      const rawRefresh = 'refresh-reauth-1'
      const rawGrant = 'grant-reauth-1'

      const session = await state.issueAccessSession(
        {
          rawAccessToken: rawAccess,
          identity: {
            userId: account.userId,
            profileId: account.profileId,
            organizationId: account.organizationId,
            email: account.email,
            cloudProfileId: 'c_prf_eefr'
          },
          ttlMs: 3600_000
        },
        t0
      )

      await state.issueRefreshToken(
        {
          sessionId: session.sessionId,
          rawRefreshToken: rawRefresh,
          ttlMs: null
        },
        t0
      )

      await state.issueRelayGrant(
        {
          rawRelayToken: rawGrant,
          parentSessionId: session.sessionId,
          relayHostId: hostId,
          hostPublicKeyB64: 'pk_test==',
          identity: {
            userId: account.userId,
            profileId: 'c_prf_eefr',
            organizationId: account.organizationId
          },
          ttlMs: 3600_000
        },
        t0
      )

      expect(await state.lookupRefreshToken(rawRefresh, t0 + 1000)).not.toBeNull()

      // Enable key expiry for host
      await state.setHostKeyExpiryDisabled(hostId, false, t0 + 2000)

      // Refresh token is revoked immediately, requiring PKCE reauth on next startup/refresh
      expect(await state.lookupRefreshToken(rawRefresh, t0 + 3000)).toBeNull()
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

      const grantByTokenPastExpiry = await state.validateRelayGrantByToken(
        rawGrantToken,
        t0 + 5000
      )
      expect(grantByTokenPastExpiry).not.toBeNull()

      // Now enable key expiry for host (disabled = false)
      await state.setHostKeyExpiryDisabled(hostId, false)
      expect(await state.isHostKeyExpiryDisabled(hostId)).toBe(false)

      // Now grant past 1s TTL fails because host key expiry is enabled
      const grantExpired = await state.validateRelayGrantById(
        grant!.grantId,
        hostId,
        t0 + 5000
      )
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
