import type {
  OwnMobileRelaySecurityState,
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
import type {
  InternalAccountRecord,
  InternalDeviceRecord,
  InternalGrantRecord,
  InternalOperatorSessionRecord,
  InternalSessionRecord
} from './own-mobile-relay-security-state-types'
import {
  issueAccessSessionMemory,
  replaceAccessSessionMemory,
  issueRelayGrantMemory,
  type MemoryStoreContext
} from './own-mobile-relay-security-state-memory-ops'
import { createMemoryAccountFacet } from './own-mobile-relay-security-state-memory-account-facet'
import {
  lookupAccessSessionByTokenMemory,
  revokeAccessSessionByIdMemory,
  revokeAccessSessionByTokenMemory,
  validateRelayGrantByTokenMemory,
  validateRelayGrantByIdMemory,
  revokeRelayGrantByIdMemory
} from './own-mobile-relay-security-state-grant-ops'
import {
  installDeviceCredentialMemory,
  getDeviceCredentialInstallStatusMemory,
  matchDeviceCredentialMemory,
  revokeDeviceCredentialMemory
} from './own-mobile-relay-security-state-device-ops'
import {
  listAccessSessionsMemory,
  listRelayGrantsMemory,
  listDeviceCredentialsMemory,
  issueOperatorSessionMemory,
  lookupOperatorSessionMemory,
  revokeOperatorSessionMemory
} from './own-mobile-relay-security-state-operator-ops'
import {
  cleanupExpiredMemory,
  closeMemoryStore
} from './own-mobile-relay-security-state-memory-lifecycle'
import {
  issueRefreshTokenMemory,
  lookupRefreshTokenMemory,
  rotateRefreshTokenMemory,
  revokeRefreshTokensForSessionMemory,
  isHostKeyExpiryDisabledMemory,
  setHostKeyExpiryDisabledMemory,
  isDeviceKeyExpiryDisabledMemory,
  setDeviceKeyExpiryDisabledMemory
} from './own-mobile-relay-security-state-refresh-ops'

export function createOwnMobileRelaySecurityStateMemory(): OwnMobileRelaySecurityState {
  const ctx: MemoryStoreContext = {
    isClosed: false,
    account: null,
    accountsById: new Map<string, InternalAccountRecord>(),
    sessionsById: new Map<string, InternalSessionRecord>(),
    sessionsByAccessHash: new Map<string, string>(),
    grantsById: new Map<string, InternalGrantRecord>(),
    grantsByTokenHash: new Map<string, string>(),
    devicesByKey: new Map<string, InternalDeviceRecord>(),
    operatorSessionsById: new Map<string, InternalOperatorSessionRecord>(),
    operatorSessionsByTokenHash: new Map<string, string>(),
    refreshTokensByHash: new Map(),
    refreshHashesBySessionId: new Map(),
    hostKeyExpiry: new Map()
  }

  return {
    _memoryCtx: ctx,
    ...createMemoryAccountFacet(ctx),

    async issueAccessSession(
      input: SecurityStateIssueAccessSessionInput,
      now = Date.now()
    ): Promise<SecurityStateIssuedAccessSession> {
      return issueAccessSessionMemory(ctx, input, now)
    },

    async lookupAccessSessionByToken(
      rawAccessToken: string,
      now = Date.now()
    ): Promise<SecurityStateAccessSession | null> {
      return lookupAccessSessionByTokenMemory(ctx, rawAccessToken, now)
    },

    async replaceAccessSession(
      input: SecurityStateReplaceAccessSessionInput,
      now = Date.now()
    ): Promise<SecurityStateIssuedAccessSession | null> {
      return replaceAccessSessionMemory(ctx, input, now)
    },

    async revokeAccessSessionById(sessionId: string, now = Date.now()): Promise<boolean> {
      return revokeAccessSessionByIdMemory(ctx, sessionId, now)
    },

    async revokeAccessSessionByToken(rawAccessToken: string, now = Date.now()): Promise<boolean> {
      return revokeAccessSessionByTokenMemory(ctx, rawAccessToken, now)
    },

    async issueRefreshToken(
      input: SecurityStateIssueRefreshTokenInput,
      now = Date.now()
    ): Promise<void> {
      return issueRefreshTokenMemory(ctx, input, now)
    },

    async lookupRefreshToken(
      rawRefreshToken: string,
      now = Date.now()
    ): Promise<SecurityStateLookupRefreshTokenResult | null> {
      return lookupRefreshTokenMemory(ctx, rawRefreshToken, now)
    },

    async rotateRefreshToken(
      input: SecurityStateRotateRefreshTokenInput,
      now = Date.now()
    ): Promise<SecurityStateIssuedAccessSession | null> {
      return rotateRefreshTokenMemory(ctx, input, now)
    },

    async revokeRefreshTokensForSession(sessionId: string, now = Date.now()): Promise<void> {
      return revokeRefreshTokensForSessionMemory(ctx, sessionId, now)
    },

    async isHostKeyExpiryDisabled(relayHostId: string): Promise<boolean> {
      return isHostKeyExpiryDisabledMemory(ctx, relayHostId)
    },

    async setHostKeyExpiryDisabled(
      relayHostId: string,
      disabled: boolean,
      _now = Date.now()
    ): Promise<void> {
      return setHostKeyExpiryDisabledMemory(ctx, relayHostId, disabled)
    },

    async isDeviceKeyExpiryDisabled(relayHostId: string, relayDeviceId: string): Promise<boolean> {
      return isDeviceKeyExpiryDisabledMemory(ctx, relayHostId, relayDeviceId)
    },

    async setDeviceKeyExpiryDisabled(
      relayHostId: string,
      relayDeviceId: string,
      disabled: boolean,
      _now = Date.now()
    ): Promise<void> {
      return setDeviceKeyExpiryDisabledMemory(ctx, relayHostId, relayDeviceId, disabled)
    },

    async issueRelayGrant(
      input: SecurityStateIssueRelayGrantInput,
      now = Date.now()
    ): Promise<SecurityStateIssuedRelayGrant | null> {
      return issueRelayGrantMemory(ctx, input, now)
    },

    async validateRelayGrantByToken(
      rawRelayToken: string,
      now = Date.now()
    ): Promise<SecurityStateRelayGrant | null> {
      return validateRelayGrantByTokenMemory(ctx, rawRelayToken, now)
    },

    async validateRelayGrantById(
      grantId: string,
      relayHostId?: string,
      now = Date.now()
    ): Promise<SecurityStateRelayGrant | null> {
      return validateRelayGrantByIdMemory(ctx, grantId, relayHostId, now)
    },

    async revokeRelayGrantById(grantId: string, now = Date.now()): Promise<boolean> {
      return revokeRelayGrantByIdMemory(ctx, grantId, now)
    },

    async installDeviceCredential(
      input: SecurityStateDeviceInstallInput,
      now = Date.now()
    ): Promise<SecurityStateDeviceInstallResult> {
      return installDeviceCredentialMemory(ctx, input, now)
    },

    async getDeviceCredentialInstallStatus(
      relayHostId: string,
      relayDeviceId: string,
      reqId: string
    ): Promise<SecurityStateDeviceInstallStatusResult> {
      return getDeviceCredentialInstallStatusMemory(ctx, relayHostId, relayDeviceId, reqId)
    },

    async matchDeviceCredential(
      relayHostId: string,
      tokenHash: string,
      now = Date.now()
    ): Promise<SecurityStateDeviceMatchResult | null> {
      return matchDeviceCredentialMemory(ctx, relayHostId, tokenHash, now)
    },

    async revokeDeviceCredential(
      relayHostId: string,
      relayDeviceId: string,
      now = Date.now()
    ): Promise<boolean> {
      return revokeDeviceCredentialMemory(ctx, relayHostId, relayDeviceId, now)
    },

    async listAccessSessions(now = Date.now()): Promise<SecurityStateRedactedAccessSession[]> {
      return listAccessSessionsMemory(ctx, now)
    },

    async listRelayGrants(now = Date.now()): Promise<SecurityStateRedactedRelayGrant[]> {
      return listRelayGrantsMemory(ctx, now)
    },

    async listDeviceCredentials(): Promise<SecurityStateRedactedDeviceCredential[]> {
      return listDeviceCredentialsMemory(ctx)
    },

    async issueOperatorSession(
      input: SecurityStateIssueOperatorSessionInput,
      now = Date.now()
    ): Promise<SecurityStateIssuedOperatorSession> {
      return issueOperatorSessionMemory(ctx, input, now)
    },

    async lookupOperatorSession(
      rawToken: string,
      now = Date.now()
    ): Promise<SecurityStateOperatorSession | null> {
      return lookupOperatorSessionMemory(ctx, rawToken, now)
    },

    async revokeOperatorSession(rawToken: string, now = Date.now()): Promise<boolean> {
      return revokeOperatorSessionMemory(ctx, rawToken, now)
    },

    async cleanupExpired(options?: {
      maxBatchSize?: number
      now?: number
    }): Promise<SecurityStateCleanupResult> {
      return cleanupExpiredMemory(ctx, options)
    },

    async close(): Promise<void> {
      closeMemoryStore(ctx)
    }
  }
}
