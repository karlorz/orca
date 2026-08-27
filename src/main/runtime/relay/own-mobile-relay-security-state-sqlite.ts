import { existsSync, chmodSync, openSync, closeSync } from 'node:fs'
import { dirname } from 'node:path'
import process from 'node:process'
import { DatabaseSync } from 'node:sqlite'
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
  SecurityStateCleanupResult
} from './own-mobile-relay-security-state'
import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_BUSY_TIMEOUT_MS,
  applySqlitePragmas,
  runSqliteMigrations,
  verifySqliteParentDirectorySecurity,
  verifySqlitePathSecurity,
  verifySqliteQuickCheck
} from './own-mobile-relay-security-state-sqlite-schema'
import {
  executeBootstrapAccountSqlite,
  executeGetAccountSqlite,
  executeGetAccountPasswordRecordSqlite,
  executeReplacePasswordVerifierSqlite,
  executeUpgradePasswordVerifierSqlite
} from './own-mobile-relay-security-state-sqlite-account-ops'
import {
  executeIssueAccessSessionSqlite,
  executeLookupAccessSessionByTokenSqlite,
  executeReplaceAccessSessionSqlite,
  executeRevokeAccessSessionByIdSqlite,
  executeRevokeAccessSessionByTokenSqlite
} from './own-mobile-relay-security-state-sqlite-session-ops'
import {
  executeIssueRelayGrantSqlite,
  executeValidateRelayGrantByTokenSqlite,
  executeValidateRelayGrantByIdSqlite
} from './own-mobile-relay-security-state-sqlite-grant-ops'
import {
  executeInstallDeviceCredentialSqlite,
  executeGetDeviceCredentialInstallStatusSqlite,
  executeMatchDeviceCredentialSqlite,
  executeRevokeDeviceCredentialSqlite,
  executeCleanupExpiredSqlite
} from './own-mobile-relay-security-state-sqlite-device-ops'

export { CURRENT_SCHEMA_VERSION, verifySqliteParentDirectorySecurity, verifySqlitePathSecurity }

export type SqliteSecurityFsHook = {
  chmodSync?: (path: string, mode: number) => void
  postOpenHook?: () => void | Promise<void>
}

export type SqliteSecurityStateOptions = {
  dbPath: string
  testMode?: boolean
  busyTimeoutMs?: number
  injectedFs?: SqliteSecurityFsHook
}

export type SqliteDbContext = {
  db: DatabaseSync
  isClosed: boolean
}

export function openOwnMobileRelaySecurityStateSqlite(
  options: SqliteSecurityStateOptions
): OwnMobileRelaySecurityState {
  const { dbPath, testMode = false, busyTimeoutMs = DEFAULT_BUSY_TIMEOUT_MS, injectedFs } = options

  const parentDir = dirname(dbPath)
  if (!testMode) {
    verifySqliteParentDirectorySecurity(parentDir)
    verifySqlitePathSecurity(dbPath)
  }

  const prevUmask = process.umask(0o077)
  let db: DatabaseSync
  try {
    const fileExists = existsSync(dbPath)
    if (!fileExists) {
      // Create file with 0600 permissions
      const fd = openSync(dbPath, 'w', 0o600)
      closeSync(fd)
      if (injectedFs?.chmodSync) {
        injectedFs.chmodSync(dbPath, 0o600)
      } else {
        chmodSync(dbPath, 0o600)
      }
    }

    db = new DatabaseSync(dbPath)

    try {
      applySqlitePragmas(db, busyTimeoutMs)
      verifySqliteQuickCheck(db)
      runSqliteMigrations(db)

      if (injectedFs?.postOpenHook) {
        const res = injectedFs.postOpenHook()
        if (res && typeof (res as Promise<void>).then === 'function') {
          throw new Error('postOpenHook must be synchronous in SQLite open')
        }
      }

      if (!testMode) {
        // Re-verify main DB and sidecars after open/pragma execution
        verifySqlitePathSecurity(dbPath)
      }
    } catch (err) {
      try {
        db.close()
      } catch {
        // Ignore close error on failed setup
      }
      throw err
    }
  } finally {
    process.umask(prevUmask)
  }

  const ctx: SqliteDbContext = {
    db,
    isClosed: false
  }

  function assertOpen(): void {
    if (ctx.isClosed) {
      throw new Error('Security state adapter is closed')
    }
  }

  return {
    async getAccount(): Promise<SecurityStateAccountIdentity | null> {
      assertOpen()
      return executeGetAccountSqlite(ctx.db)
    },

    async bootstrapAccount(
      input: SecurityStateAccountBootstrapInput,
      now = Date.now()
    ): Promise<SecurityStateAccountIdentity> {
      assertOpen()
      return executeBootstrapAccountSqlite(ctx.db, input, now)
    },

    async getAccountPasswordRecord(): Promise<{
      accountId: string
      verifierVersion: number
      authEpoch: number
      passwordRecord: PasswordRecord
    } | null> {
      assertOpen()
      return executeGetAccountPasswordRecordSqlite(ctx.db)
    },

    async replacePasswordVerifier(
      input: { expectedVerifierVersion: number; newPasswordRecord: PasswordRecord },
      now = Date.now()
    ): Promise<
      | { ok: true; account: SecurityStateAccountIdentity }
      | { ok: false; error: 'version_mismatch' | 'not_found' }
    > {
      assertOpen()
      return executeReplacePasswordVerifierSqlite(ctx.db, input, now)
    },

    async upgradePasswordVerifier(
      input: { expectedVerifierVersion: number; newPasswordRecord: PasswordRecord },
      now = Date.now()
    ): Promise<
      | { ok: true; account: SecurityStateAccountIdentity }
      | { ok: false; error: 'version_mismatch' | 'not_found' }
    > {
      assertOpen()
      return executeUpgradePasswordVerifierSqlite(ctx.db, input, now)
    },

    async issueAccessSession(
      input: SecurityStateIssueAccessSessionInput,
      now = Date.now()
    ): Promise<SecurityStateIssuedAccessSession> {
      assertOpen()
      return executeIssueAccessSessionSqlite(ctx.db, input, now)
    },

    async lookupAccessSessionByToken(
      rawAccessToken: string,
      now = Date.now()
    ): Promise<SecurityStateAccessSession | null> {
      assertOpen()
      return executeLookupAccessSessionByTokenSqlite(ctx.db, rawAccessToken, now)
    },

    async replaceAccessSession(
      input: SecurityStateReplaceAccessSessionInput,
      now = Date.now()
    ): Promise<SecurityStateIssuedAccessSession | null> {
      assertOpen()
      return executeReplaceAccessSessionSqlite(ctx.db, input, now)
    },

    async revokeAccessSessionById(sessionId: string, now = Date.now()): Promise<boolean> {
      assertOpen()
      return executeRevokeAccessSessionByIdSqlite(ctx.db, sessionId, now)
    },

    async revokeAccessSessionByToken(rawAccessToken: string, now = Date.now()): Promise<boolean> {
      assertOpen()
      return executeRevokeAccessSessionByTokenSqlite(ctx.db, rawAccessToken, now)
    },

    async issueRelayGrant(
      input: SecurityStateIssueRelayGrantInput,
      now = Date.now()
    ): Promise<SecurityStateIssuedRelayGrant | null> {
      assertOpen()
      return executeIssueRelayGrantSqlite(ctx.db, input, now)
    },

    async validateRelayGrantByToken(
      rawRelayToken: string,
      now = Date.now()
    ): Promise<SecurityStateRelayGrant | null> {
      assertOpen()
      return executeValidateRelayGrantByTokenSqlite(ctx.db, rawRelayToken, now)
    },

    async validateRelayGrantById(
      grantId: string,
      relayHostId?: string,
      now = Date.now()
    ): Promise<SecurityStateRelayGrant | null> {
      assertOpen()
      return executeValidateRelayGrantByIdSqlite(ctx.db, grantId, relayHostId, now)
    },

    async installDeviceCredential(
      input: SecurityStateDeviceInstallInput,
      now = Date.now()
    ): Promise<SecurityStateDeviceInstallResult> {
      assertOpen()
      return executeInstallDeviceCredentialSqlite(ctx.db, input, now)
    },

    async getDeviceCredentialInstallStatus(
      relayHostId: string,
      relayDeviceId: string,
      reqId: string
    ): Promise<SecurityStateDeviceInstallStatusResult> {
      assertOpen()
      return executeGetDeviceCredentialInstallStatusSqlite(
        ctx.db,
        relayHostId,
        relayDeviceId,
        reqId
      )
    },

    async matchDeviceCredential(
      relayHostId: string,
      tokenHash: string,
      now = Date.now()
    ): Promise<SecurityStateDeviceMatchResult | null> {
      assertOpen()
      return executeMatchDeviceCredentialSqlite(ctx.db, relayHostId, tokenHash, now)
    },

    async revokeDeviceCredential(
      relayHostId: string,
      relayDeviceId: string,
      now = Date.now()
    ): Promise<boolean> {
      assertOpen()
      return executeRevokeDeviceCredentialSqlite(ctx.db, relayHostId, relayDeviceId, now)
    },

    async cleanupExpired(options?: {
      maxBatchSize?: number
      now?: number
    }): Promise<SecurityStateCleanupResult> {
      assertOpen()
      return executeCleanupExpiredSqlite(
        ctx.db,
        options?.maxBatchSize ?? 1000,
        options?.now ?? Date.now()
      )
    },

    async close(): Promise<void> {
      if (ctx.isClosed) {
        return
      }
      ctx.isClosed = true
      ctx.db.close()
    }
  }
}

export const createOwnMobileRelaySecurityStateSqlite = openOwnMobileRelaySecurityStateSqlite
