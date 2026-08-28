import type { PasswordRecord } from './own-mobile-relay-password'
import type {
  OwnMobileRelaySecurityState,
  SecurityStateAccountBootstrapInput,
  SecurityStateAccountIdentity,
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
  SecurityStateIssuedOperatorSession
} from './own-mobile-relay-security-state'
import type {
  InternalDeviceRecord,
  InternalGrantRecord,
  InternalOperatorSessionRecord,
  InternalSessionRecord
} from './own-mobile-relay-security-state-types'
import { cleanupExpiredRecords } from './own-mobile-relay-security-state-device-cleanup'
import {
  assertOpen,
  bootstrapAccountMemory,
  replacePasswordVerifierMemory,
  upgradePasswordVerifierMemory,
  issueAccessSessionMemory,
  replaceAccessSessionMemory,
  issueRelayGrantMemory,
  toPublicAccount,
  type MemoryStoreContext
} from './own-mobile-relay-security-state-memory-ops'
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

export function createOwnMobileRelaySecurityStateMemory(): OwnMobileRelaySecurityState {
  const ctx: MemoryStoreContext = {
    isClosed: false,
    account: null,
    sessionsById: new Map<string, InternalSessionRecord>(),
    sessionsByAccessHash: new Map<string, string>(),
    grantsById: new Map<string, InternalGrantRecord>(),
    grantsByTokenHash: new Map<string, string>(),
    devicesByKey: new Map<string, InternalDeviceRecord>(),
    operatorSessionsById: new Map<string, InternalOperatorSessionRecord>(),
    operatorSessionsByTokenHash: new Map<string, string>()
  }

  return {
    async getAccount(): Promise<SecurityStateAccountIdentity | null> {
      assertOpen(ctx)
      return ctx.account ? toPublicAccount(ctx.account) : null
    },

    async bootstrapAccount(
      input: SecurityStateAccountBootstrapInput,
      now = Date.now()
    ): Promise<SecurityStateAccountIdentity> {
      return bootstrapAccountMemory(ctx, input, now)
    },

    async getAccountPasswordRecord(): Promise<{
      accountId: string
      verifierVersion: number
      authEpoch: number
      passwordRecord: PasswordRecord
    } | null> {
      assertOpen(ctx)
      if (!ctx.account) {
        return null
      }
      return {
        accountId: ctx.account.accountId,
        verifierVersion: ctx.account.verifierVersion,
        authEpoch: ctx.account.authEpoch,
        passwordRecord: ctx.account.passwordRecord
      }
    },

    async replacePasswordVerifier(
      input: { expectedVerifierVersion: number; newPasswordRecord: PasswordRecord },
      now = Date.now()
    ): Promise<
      | { ok: true; account: SecurityStateAccountIdentity }
      | { ok: false; error: 'version_mismatch' | 'not_found' }
    > {
      return replacePasswordVerifierMemory(ctx, input, now)
    },

    async upgradePasswordVerifier(
      input: { expectedVerifierVersion: number; newPasswordRecord: PasswordRecord },
      now = Date.now()
    ): Promise<
      | { ok: true; account: SecurityStateAccountIdentity }
      | { ok: false; error: 'version_mismatch' | 'not_found' }
    > {
      return upgradePasswordVerifierMemory(ctx, input, now)
    },

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
      assertOpen(ctx)
      const now = options?.now ?? Date.now()
      const maxBatch = options?.maxBatchSize ?? 1000
      return cleanupExpiredRecords(
        {
          byId: ctx.sessionsById,
          byAccess: ctx.sessionsByAccessHash
        },
        { byId: ctx.grantsById, byToken: ctx.grantsByTokenHash },
        ctx.devicesByKey,
        ctx.account,
        maxBatch,
        now
      )
    },

    async close(): Promise<void> {
      ctx.isClosed = true
      ctx.sessionsById.clear()
      ctx.sessionsByAccessHash.clear()
      ctx.grantsById.clear()
      ctx.grantsByTokenHash.clear()
      ctx.devicesByKey.clear()
      ctx.operatorSessionsById.clear()
      ctx.operatorSessionsByTokenHash.clear()
      ctx.account = null
    }
  }
}
