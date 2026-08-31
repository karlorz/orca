import { existsSync, chmodSync, openSync, closeSync } from 'node:fs'
import { dirname } from 'node:path'
import process from 'node:process'
import { DatabaseSync } from 'node:sqlite'
import type { OwnMobileRelaySecurityState } from './own-mobile-relay-security-state'
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
  executeValidateRelayGrantByIdSqlite,
  executeRevokeRelayGrantByIdSqlite
} from './own-mobile-relay-security-state-sqlite-grant-ops'
import {
  executeInstallDeviceCredentialSqlite,
  executeGetDeviceCredentialInstallStatusSqlite,
  executeMatchDeviceCredentialSqlite,
  executeRevokeDeviceCredentialSqlite,
  executeCleanupExpiredSqlite
} from './own-mobile-relay-security-state-sqlite-device-ops'
import {
  executeListAccessSessionsSqlite,
  executeListRelayGrantsSqlite,
  executeListDeviceCredentialsSqlite,
  executeIssueOperatorSessionSqlite,
  executeLookupOperatorSessionSqlite,
  executeRevokeOperatorSessionSqlite
} from './own-mobile-relay-security-state-sqlite-operator-ops'
import {
  executeIssueRefreshTokenSqlite,
  executeLookupRefreshTokenSqlite,
  executeRotateRefreshTokenSqlite,
  executeRevokeRefreshTokensForSessionSqlite,
  executeIsHostKeyExpiryDisabledSqlite,
  executeSetHostKeyExpiryDisabledSqlite,
  executeIsDeviceKeyExpiryDisabledSqlite,
  executeSetDeviceKeyExpiryDisabledSqlite
} from './own-mobile-relay-security-state-sqlite-refresh-ops'

export { CURRENT_SCHEMA_VERSION, verifySqliteParentDirectorySecurity, verifySqlitePathSecurity }

export type SqliteSecurityStateOptions = {
  dbPath: string
  testMode?: boolean
  busyTimeoutMs?: number
}

export type SqliteDbContext = {
  db: DatabaseSync
  isClosed: boolean
}

export function openOwnMobileRelaySecurityStateSqlite(
  options: SqliteSecurityStateOptions
): OwnMobileRelaySecurityState {
  const { dbPath, testMode = false, busyTimeoutMs = DEFAULT_BUSY_TIMEOUT_MS } = options

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
      chmodSync(dbPath, 0o600)
    }

    db = new DatabaseSync(dbPath)

    try {
      applySqlitePragmas(db, busyTimeoutMs)
      verifySqliteQuickCheck(db)
      runSqliteMigrations(db)

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
    getAccount: async () => {
      assertOpen()
      return executeGetAccountSqlite(ctx.db)
    },
    bootstrapAccount: async (input, now = Date.now()) => {
      assertOpen()
      return executeBootstrapAccountSqlite(ctx.db, input, now)
    },
    getAccountPasswordRecord: async () => {
      assertOpen()
      return executeGetAccountPasswordRecordSqlite(ctx.db)
    },
    replacePasswordVerifier: async (input, now = Date.now()) => {
      assertOpen()
      return executeReplacePasswordVerifierSqlite(ctx.db, input, now)
    },
    upgradePasswordVerifier: async (input, now = Date.now()) => {
      assertOpen()
      return executeUpgradePasswordVerifierSqlite(ctx.db, input, now)
    },
    issueAccessSession: async (input, now = Date.now()) => {
      assertOpen()
      return executeIssueAccessSessionSqlite(ctx.db, input, now)
    },
    lookupAccessSessionByToken: async (rawAccessToken, now = Date.now()) => {
      assertOpen()
      return executeLookupAccessSessionByTokenSqlite(ctx.db, rawAccessToken, now)
    },
    replaceAccessSession: async (input, now = Date.now()) => {
      assertOpen()
      return executeReplaceAccessSessionSqlite(ctx.db, input, now)
    },
    revokeAccessSessionById: async (sessionId, now = Date.now()) => {
      assertOpen()
      return executeRevokeAccessSessionByIdSqlite(ctx.db, sessionId, now)
    },
    revokeAccessSessionByToken: async (rawAccessToken, now = Date.now()) => {
      assertOpen()
      return executeRevokeAccessSessionByTokenSqlite(ctx.db, rawAccessToken, now)
    },
    issueRefreshToken: async (input, now = Date.now()) => {
      assertOpen()
      return executeIssueRefreshTokenSqlite(ctx.db, input, now)
    },
    lookupRefreshToken: async (rawRefreshToken, now = Date.now()) => {
      assertOpen()
      return executeLookupRefreshTokenSqlite(ctx.db, rawRefreshToken, now)
    },
    rotateRefreshToken: async (input, now = Date.now()) => {
      assertOpen()
      return executeRotateRefreshTokenSqlite(ctx.db, input, now)
    },
    revokeRefreshTokensForSession: async (sessionId, now = Date.now()) => {
      assertOpen()
      return executeRevokeRefreshTokensForSessionSqlite(ctx.db, sessionId, now)
    },
    isHostKeyExpiryDisabled: async (relayHostId) => {
      assertOpen()
      return executeIsHostKeyExpiryDisabledSqlite(ctx.db, relayHostId)
    },
    setHostKeyExpiryDisabled: async (relayHostId, disabled, now = Date.now()) => {
      assertOpen()
      return executeSetHostKeyExpiryDisabledSqlite(ctx.db, relayHostId, disabled, now)
    },
    isDeviceKeyExpiryDisabled: async (relayHostId, relayDeviceId) => {
      assertOpen()
      return executeIsDeviceKeyExpiryDisabledSqlite(ctx.db, relayHostId, relayDeviceId)
    },
    setDeviceKeyExpiryDisabled: async (relayHostId, relayDeviceId, disabled) => {
      assertOpen()
      return executeSetDeviceKeyExpiryDisabledSqlite(ctx.db, relayHostId, relayDeviceId, disabled)
    },
    issueRelayGrant: async (input, now = Date.now()) => {
      assertOpen()
      return executeIssueRelayGrantSqlite(ctx.db, input, now)
    },
    validateRelayGrantByToken: async (rawRelayToken, now = Date.now()) => {
      assertOpen()
      return executeValidateRelayGrantByTokenSqlite(ctx.db, rawRelayToken, now)
    },
    validateRelayGrantById: async (grantId, relayHostId, now = Date.now()) => {
      assertOpen()
      return executeValidateRelayGrantByIdSqlite(ctx.db, grantId, relayHostId, now)
    },
    revokeRelayGrantById: async (grantId, now = Date.now()) => {
      assertOpen()
      return executeRevokeRelayGrantByIdSqlite(ctx.db, grantId, now)
    },
    installDeviceCredential: async (input, now = Date.now()) => {
      assertOpen()
      return executeInstallDeviceCredentialSqlite(ctx.db, input, now)
    },
    getDeviceCredentialInstallStatus: async (relayHostId, relayDeviceId, reqId) => {
      assertOpen()
      return executeGetDeviceCredentialInstallStatusSqlite(
        ctx.db,
        relayHostId,
        relayDeviceId,
        reqId
      )
    },
    matchDeviceCredential: async (relayHostId, tokenHash, now = Date.now()) => {
      assertOpen()
      return executeMatchDeviceCredentialSqlite(ctx.db, relayHostId, tokenHash, now)
    },
    revokeDeviceCredential: async (relayHostId, relayDeviceId, now = Date.now()) => {
      assertOpen()
      return executeRevokeDeviceCredentialSqlite(ctx.db, relayHostId, relayDeviceId, now)
    },
    listAccessSessions: async (now = Date.now()) => {
      assertOpen()
      return executeListAccessSessionsSqlite(ctx.db, now)
    },
    listRelayGrants: async (now = Date.now()) => {
      assertOpen()
      return executeListRelayGrantsSqlite(ctx.db, now)
    },
    listDeviceCredentials: async () => {
      assertOpen()
      return executeListDeviceCredentialsSqlite(ctx.db)
    },
    issueOperatorSession: async (input, now = Date.now()) => {
      assertOpen()
      return executeIssueOperatorSessionSqlite(ctx.db, input, now)
    },
    lookupOperatorSession: async (rawToken, now = Date.now()) => {
      assertOpen()
      return executeLookupOperatorSessionSqlite(ctx.db, rawToken, now)
    },
    revokeOperatorSession: async (rawToken, now = Date.now()) => {
      assertOpen()
      return executeRevokeOperatorSessionSqlite(ctx.db, rawToken, now)
    },
    cleanupExpired: async (options) => {
      assertOpen()
      return executeCleanupExpiredSqlite(
        ctx.db,
        options?.maxBatchSize ?? 1000,
        options?.now ?? Date.now()
      )
    },
    close: async () => {
      if (ctx.isClosed) {
        return
      }
      ctx.isClosed = true
      ctx.db.close()
    }
  }
}

export const createOwnMobileRelaySecurityStateSqlite = openOwnMobileRelaySecurityStateSqlite
