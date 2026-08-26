import type { PasswordRecord } from './own-mobile-relay-password'

export type SecurityStateAccountIdentity = {
  readonly accountId: string
  readonly email: string
  readonly userId: string
  readonly profileId: string
  readonly organizationId: string
  readonly verifierVersion: number
  readonly authEpoch: number
  readonly createdAt: number
  readonly updatedAt: number
}

export type SecurityStateAccountBootstrapInput = {
  readonly email: string
  readonly userId: string
  readonly profileId: string
  readonly organizationId: string
  readonly passwordRecord: PasswordRecord
}

export type SecurityStateAccessSession = {
  readonly sessionId: string
  readonly accountId: string
  readonly authEpoch: number
  readonly expiresAt: number
  readonly createdAt: number
  readonly identity: {
    readonly userId: string
    readonly profileId: string
    readonly organizationId: string
    readonly email: string
    readonly cloudProfileId: string
  }
}

export type SecurityStateIssueAccessSessionInput = {
  readonly rawAccessToken: string
  readonly rawRefreshToken: string
  readonly identity: {
    readonly userId: string
    readonly profileId: string
    readonly organizationId: string
    readonly email: string
    readonly cloudProfileId: string
  }
  readonly ttlMs: number
}

export type SecurityStateIssuedAccessSession = {
  readonly sessionId: string
  readonly accountId: string
  readonly authEpoch: number
  readonly expiresAt: number
  readonly identity: SecurityStateAccessSession['identity']
}

export type SecurityStateRelayGrant = {
  readonly grantId: string
  readonly accountId: string
  readonly parentSessionId: string
  readonly relayHostId: string
  readonly hostPublicKeyB64: string
  readonly authEpoch: number
  readonly expiresAt: number
  readonly createdAt: number
  readonly identity: {
    readonly userId: string
    readonly profileId: string
    readonly organizationId: string
  }
}

export type SecurityStateIssueRelayGrantInput = {
  readonly rawRelayToken: string
  readonly parentSessionId: string
  readonly relayHostId: string
  readonly hostPublicKeyB64: string
  readonly identity: {
    readonly userId: string
    readonly profileId: string
    readonly organizationId: string
  }
  readonly ttlMs: number
}

export type SecurityStateIssuedRelayGrant = {
  readonly grantId: string
  readonly relayHostId: string
  readonly hostPublicKeyB64: string
  readonly expiresAt: number
  readonly identity: SecurityStateRelayGrant['identity']
}

export type SecurityStateDeviceCredential = {
  readonly relayHostId: string
  readonly relayDeviceId: string
  readonly lastInstallReqId: string
  readonly currentVersion: number
  readonly resumeExpiresAt: number
  readonly authorizationMode: 'relay-basis' | 'authenticated-direct'
  readonly graceExpiresAt?: number
}

export type SecurityStateDeviceInstallInput = {
  readonly relayHostId: string
  readonly relayDeviceId: string
  readonly reqId: string
  readonly newResumeTokenHash: string
  readonly expectedCurrentHash?: string
  readonly authorizationMode: 'relay-basis' | 'authenticated-direct'
  readonly resumeTtlMs?: number
  readonly graceTtlMs?: number
}

export type SecurityStateDeviceInstallResult =
  | {
      readonly ok: true
      readonly installed: {
        readonly v: 1
        readonly reqId: string
        readonly authorizationMode: 'relay-basis' | 'authenticated-direct'
        readonly currentVersion: number
        readonly resumeExpiresAt: number
        readonly graceExpiresAt?: number
      }
    }
  | {
      readonly ok: false
      readonly code: 'hash-mismatch' | 'invalid_token_hash' | 'invalid_authorization'
    }

export type SecurityStateDeviceInstallStatusResult =
  | {
      readonly v: 1
      readonly reqId: string
      readonly state: 'not-found'
    }
  | {
      readonly v: 1
      readonly reqId: string
      readonly state: 'committed'
      readonly result: {
        readonly v: 1
        readonly reqId: string
        readonly authorizationMode: 'relay-basis' | 'authenticated-direct'
        readonly currentVersion: number
        readonly resumeExpiresAt: number
        readonly graceExpiresAt?: number
      }
    }

export type SecurityStateDeviceMatchResult = {
  readonly device: SecurityStateDeviceCredential
  readonly acceptedAs: 'current' | 'grace'
}

export type SecurityStateCleanupResult = {
  readonly expiredSessionsDeleted: number
  readonly expiredGrantsDeleted: number
  readonly expiredDevicesDeleted: number
}

export type OwnMobileRelaySecurityState = {
  getAccount(now?: number): Promise<SecurityStateAccountIdentity | null>
  bootstrapAccount(
    input: SecurityStateAccountBootstrapInput,
    now?: number
  ): Promise<SecurityStateAccountIdentity>
  getAccountPasswordRecord(): Promise<{
    accountId: string
    verifierVersion: number
    authEpoch: number
    passwordRecord: PasswordRecord
  } | null>
  replacePasswordVerifier(
    input: { expectedVerifierVersion: number; newPasswordRecord: PasswordRecord },
    now?: number
  ): Promise<
    | { ok: true; account: SecurityStateAccountIdentity }
    | { ok: false; error: 'version_mismatch' | 'not_found' }
  >

  issueAccessSession(
    input: SecurityStateIssueAccessSessionInput,
    now?: number
  ): Promise<SecurityStateIssuedAccessSession>
  lookupAccessSessionByToken(
    rawAccessToken: string,
    now?: number
  ): Promise<SecurityStateAccessSession | null>
  lookupAccessSessionByRefreshToken(
    rawRefreshToken: string,
    now?: number
  ): Promise<SecurityStateAccessSession | null>
  rotateAccessSession(
    input: {
      rawRefreshToken: string
      newRawAccessToken: string
      newRawRefreshToken: string
      ttlMs: number
    },
    now?: number
  ): Promise<SecurityStateIssuedAccessSession | null>
  revokeAccessSession(rawAccessTokenOrSessionId: string, now?: number): Promise<boolean>
  revokeAccessSessionByRefreshToken(rawRefreshToken: string, now?: number): Promise<boolean>

  issueRelayGrant(
    input: SecurityStateIssueRelayGrantInput,
    now?: number
  ): Promise<SecurityStateIssuedRelayGrant | null>
  validateRelayGrantByToken(
    rawRelayToken: string,
    now?: number
  ): Promise<SecurityStateRelayGrant | null>
  validateRelayGrantById(
    grantId: string,
    relayHostId?: string,
    now?: number
  ): Promise<SecurityStateRelayGrant | null>

  installDeviceCredential(
    input: SecurityStateDeviceInstallInput,
    now?: number
  ): Promise<SecurityStateDeviceInstallResult>
  getDeviceCredentialInstallStatus(
    relayHostId: string,
    relayDeviceId: string,
    reqId: string
  ): Promise<SecurityStateDeviceInstallStatusResult>
  matchDeviceCredential(
    relayHostId: string,
    tokenHash: string,
    now?: number
  ): Promise<SecurityStateDeviceMatchResult | null>
  revokeDeviceCredential(relayHostId: string, relayDeviceId: string, now?: number): Promise<boolean>

  cleanupExpired(options?: {
    maxBatchSize?: number
    now?: number
  }): Promise<SecurityStateCleanupResult>
  close(): Promise<void>
}
