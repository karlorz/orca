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
  readonly identity: {
    readonly userId: string
    readonly profileId: string
    readonly organizationId: string
    readonly email: string
    readonly cloudProfileId: string
  }
  readonly ttlMs: number
  readonly expectedAccountId?: string
  readonly expectedAuthEpoch?: number
}

export type SecurityStateIssuedAccessSession = {
  readonly sessionId: string
  readonly accountId: string
  readonly authEpoch: number
  readonly expiresAt: number
  readonly identity: SecurityStateAccessSession['identity']
}

export type SecurityStateReplaceAccessSessionInput = {
  readonly oldSessionId: string
  readonly newRawAccessToken: string
  readonly ttlMs: number
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

export type SecurityStateRedactedAccessSession = {
  readonly sessionId: string
  readonly accountId: string
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

export type SecurityStateIssueRefreshTokenInput = {
  readonly sessionId: string
  readonly rawRefreshToken: string
  readonly ttlMs: number | null
}

export type SecurityStateLookupRefreshTokenResult = {
  readonly sessionId: string
  readonly cloudProfileId: string
  readonly expiresAt: number | null
}

export type SecurityStateRotateRefreshTokenInput = {
  readonly oldRawRefreshToken: string
  readonly newRawRefreshToken: string
  readonly newRawAccessToken: string
  readonly accessTtlMs: number
  readonly refreshTtlMs: number | null
}

export type SecurityStateRedactedDeviceCredential = {
  readonly relayHostId: string
  readonly relayDeviceId: string
  readonly lastInstallReqId: string
  readonly currentVersion: number
  readonly resumeExpiresAt: number
  readonly authorizationMode: 'relay-basis' | 'authenticated-direct'
  readonly graceExpiresAt?: number
  readonly revoked: boolean
  readonly keyExpiryDisabled: boolean
}

export type SecurityStateRedactedRelayGrant = {
  readonly grantId: string
  readonly accountId: string
  readonly parentSessionId: string
  readonly relayHostId: string
  readonly expiresAt: number
  readonly createdAt: number
  readonly keyExpiryDisabled: boolean
  readonly identity: {
    readonly userId: string
    readonly profileId: string
    readonly organizationId: string
  }
}

export type SecurityStateOperatorSession = {
  readonly sessionId: string
  readonly accountId: string
  readonly authEpoch: number
  readonly expiresAt: number
  readonly createdAt: number
}

export type SecurityStateIssueOperatorSessionInput = {
  readonly rawToken: string
  readonly ttlMs: number
}

export type SecurityStateIssuedOperatorSession = {
  readonly sessionId: string
  readonly accountId: string
  readonly authEpoch: number
  readonly expiresAt: number
}

export type SecurityStateCleanupResult = {
  readonly expiredSessionsDeleted: number
  readonly expiredGrantsDeleted: number
  readonly expiredDevicesDeleted: number
}

export type { OwnMobileRelaySecurityState } from './own-mobile-relay-security-state-api'
