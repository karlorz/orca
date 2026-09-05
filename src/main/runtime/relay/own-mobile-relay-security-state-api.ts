import type { PasswordRecord } from './own-mobile-relay-password'
import type {
  SecurityStateAccountIdentity,
  SecurityStateAccountBootstrapInput,
  SecurityStateAccessSession,
  SecurityStateIssueAccessSessionInput,
  SecurityStateIssuedAccessSession,
  SecurityStateReplaceAccessSessionInput,
  SecurityStateRelayGrant,
  SecurityStateIssueRelayGrantInput,
  SecurityStateIssuedRelayGrant,
  SecurityStateDeviceInstallInput,
  SecurityStateDeviceInstallResult,
  SecurityStateDeviceInstallStatusResult,
  SecurityStateDeviceMatchResult,
  SecurityStateCleanupResult,
  SecurityStateRedactedAccessSession,
  SecurityStateRedactedRelayGrant,
  SecurityStateRedactedDeviceCredential,
  SecurityStateOperatorSession,
  SecurityStateIssueOperatorSessionInput,
  SecurityStateIssuedOperatorSession,
  SecurityStateIssueRefreshTokenInput,
  SecurityStateLookupRefreshTokenResult,
  SecurityStateRotateRefreshTokenInput
} from './own-mobile-relay-security-state'

export type OwnMobileRelaySecurityState = {
  getAccount(): Promise<SecurityStateAccountIdentity | null>
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
  upgradePasswordVerifier(
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
  replaceAccessSession(
    input: SecurityStateReplaceAccessSessionInput,
    now?: number
  ): Promise<SecurityStateIssuedAccessSession | null>
  revokeAccessSessionById(sessionId: string, now?: number): Promise<boolean>
  revokeAccessSessionByToken(rawAccessToken: string, now?: number): Promise<boolean>

  issueRefreshToken(input: SecurityStateIssueRefreshTokenInput, now?: number): Promise<void>
  lookupRefreshToken(
    rawRefreshToken: string,
    now?: number
  ): Promise<SecurityStateLookupRefreshTokenResult | null>
  rotateRefreshToken(
    input: SecurityStateRotateRefreshTokenInput,
    now?: number
  ): Promise<SecurityStateIssuedAccessSession | null>
  revokeRefreshTokensForSession(sessionId: string, now?: number): Promise<void>

  isHostKeyExpiryDisabled(relayHostId: string): Promise<boolean>
  setHostKeyExpiryDisabled(relayHostId: string, disabled: boolean, now?: number): Promise<void>
  isDeviceKeyExpiryDisabled(relayHostId: string, relayDeviceId: string): Promise<boolean>
  setDeviceKeyExpiryDisabled(
    relayHostId: string,
    relayDeviceId: string,
    disabled: boolean,
    now?: number
  ): Promise<void>

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
  revokeRelayGrantById(grantId: string, now?: number): Promise<boolean>

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

  listAccessSessions(now?: number): Promise<SecurityStateRedactedAccessSession[]>
  listRelayGrants(now?: number): Promise<SecurityStateRedactedRelayGrant[]>
  listDeviceCredentials(): Promise<SecurityStateRedactedDeviceCredential[]>

  issueOperatorSession(
    input: SecurityStateIssueOperatorSessionInput,
    now?: number
  ): Promise<SecurityStateIssuedOperatorSession>
  lookupOperatorSession(
    rawToken: string,
    now?: number
  ): Promise<SecurityStateOperatorSession | null>
  revokeOperatorSession(rawToken: string, now?: number): Promise<boolean>

  cleanupExpired(options?: {
    maxBatchSize?: number
    now?: number
  }): Promise<SecurityStateCleanupResult>
  close(): Promise<void>
  readonly _sqliteCtx?: unknown
}
