import { randomBytes } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type {
  SecurityStateRedactedAccessSession,
  SecurityStateRedactedRelayGrant,
  SecurityStateRedactedDeviceCredential,
  SecurityStateOperatorSession,
  SecurityStateIssueOperatorSessionInput,
  SecurityStateIssuedOperatorSession
} from './own-mobile-relay-security-state'
import { sha256Base64Url } from './own-mobile-relay-security-state-device-cleanup'
import type { SqliteSessionRow } from './own-mobile-relay-security-state-sqlite-session-ops'
import type { SqliteGrantRow } from './own-mobile-relay-security-state-sqlite-grant-ops'
import type { SqliteDeviceRow } from './own-mobile-relay-security-state-sqlite-device-ops'

export type SqliteOperatorSessionRow = {
  session_id: string
  account_id: string
  token_hash: string
  auth_epoch: number
  expires_at: number
  created_at: number
  revoked_at: number | null
}

export function executeListAccessSessionsSqlite(
  db: DatabaseSync,
  now: number
): SecurityStateRedactedAccessSession[] {
  const rows = db
    .prepare(`
      SELECT s.session_id, s.account_id, s.auth_epoch, s.expires_at, s.created_at,
             s.user_id, s.profile_id, s.organization_id, s.email, s.cloud_profile_id
      FROM access_sessions s
      JOIN operator_account a ON a.singleton_id = 1 AND a.account_id = s.account_id
      WHERE s.revoked_at IS NULL
        AND s.expires_at > ?
        AND s.auth_epoch = a.auth_epoch
    `)
    .all(now) as SqliteSessionRow[]

  return rows.map((row) => ({
    sessionId: row.session_id,
    accountId: row.account_id,
    expiresAt: Number(row.expires_at),
    createdAt: Number(row.created_at),
    identity: {
      userId: row.user_id,
      profileId: row.profile_id,
      organizationId: row.organization_id,
      email: row.email,
      cloudProfileId: row.cloud_profile_id
    }
  }))
}

export function executeListRelayGrantsSqlite(
  db: DatabaseSync,
  now: number
): SecurityStateRedactedRelayGrant[] {
  const rows = db
    .prepare(`
      SELECT g.grant_id, g.account_id, g.parent_session_id, g.relay_host_id,
             g.host_public_key_b64, g.auth_epoch, g.expires_at, g.created_at,
             g.user_id, g.profile_id, g.organization_id,
             COALESCE(h.key_expiry_disabled, 1) as key_expiry_disabled
      FROM relay_grants g
      JOIN operator_account a ON a.singleton_id = 1 AND a.account_id = g.account_id
      JOIN access_sessions s ON s.session_id = g.parent_session_id
      LEFT JOIN host_key_expiry h ON h.relay_host_id = g.relay_host_id
      WHERE g.revoked_at IS NULL
        AND (COALESCE(h.key_expiry_disabled, 1) = 1 OR g.expires_at > ?)
        AND g.auth_epoch = a.auth_epoch
        AND s.revoked_at IS NULL
        AND s.expires_at > ?
        AND s.auth_epoch = a.auth_epoch
    `)
    .all(now, now) as (SqliteGrantRow & { key_expiry_disabled: number })[]

  return rows.map((row) => ({
    grantId: row.grant_id,
    accountId: row.account_id,
    parentSessionId: row.parent_session_id,
    relayHostId: row.relay_host_id,
    expiresAt: Number(row.expires_at),
    createdAt: Number(row.created_at),
    keyExpiryDisabled: Number(row.key_expiry_disabled) === 1,
    identity: {
      userId: row.user_id,
      profileId: row.profile_id,
      organizationId: row.organization_id
    }
  }))
}

export function executeListDeviceCredentialsSqlite(
  db: DatabaseSync
): SecurityStateRedactedDeviceCredential[] {
  const rows = db
    .prepare(`
      SELECT relay_host_id, relay_device_id, last_install_req_id,
             current_resume_token_hash, current_version, resume_expires_at,
             authorization_mode, grace_resume_token_hash, grace_expires_at, revoked_at,
             key_expiry_disabled
      FROM device_credentials
    `)
    .all() as (SqliteDeviceRow & { key_expiry_disabled?: number | null })[]

  return rows.map((row) => ({
    relayHostId: row.relay_host_id,
    relayDeviceId: row.relay_device_id,
    lastInstallReqId: row.last_install_req_id,
    currentVersion: Number(row.current_version),
    resumeExpiresAt: Number(row.resume_expires_at),
    authorizationMode: row.authorization_mode,
    ...(row.grace_expires_at !== null ? { graceExpiresAt: Number(row.grace_expires_at) } : {}),
    revoked: row.revoked_at !== null,
    keyExpiryDisabled: row.key_expiry_disabled === null || row.key_expiry_disabled === undefined || Number(row.key_expiry_disabled) === 1
  }))
}

export function executeIssueOperatorSessionSqlite(
  db: DatabaseSync,
  input: SecurityStateIssueOperatorSessionInput,
  now: number
): SecurityStateIssuedOperatorSession {
  db.exec('BEGIN IMMEDIATE;')
  try {
    const acc = db
      .prepare('SELECT account_id, auth_epoch FROM operator_account WHERE singleton_id = 1')
      .get() as { account_id: string; auth_epoch: number } | undefined
    if (!acc) {
      throw new Error('account_not_initialized')
    }
    const sessionId = randomBytes(16).toString('base64url')
    const tokenHash = sha256Base64Url(input.rawToken)
    const expiresAt = now + input.ttlMs

    const stmt = db.prepare(`
      INSERT INTO operator_sessions (
        session_id, account_id, token_hash, auth_epoch,
        expires_at, created_at, revoked_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, NULL
      )
    `)
    stmt.run(sessionId, acc.account_id, tokenHash, acc.auth_epoch, expiresAt, now)
    db.exec('COMMIT;')
    return {
      sessionId,
      accountId: acc.account_id,
      authEpoch: Number(acc.auth_epoch),
      expiresAt
    }
  } catch (err) {
    db.exec('ROLLBACK;')
    throw err
  }
}

export function executeLookupOperatorSessionSqlite(
  db: DatabaseSync,
  rawToken: string,
  now: number
): SecurityStateOperatorSession | null {
  const hash = sha256Base64Url(rawToken)
  const row = db
    .prepare(`
      SELECT s.session_id, s.account_id, s.auth_epoch, s.expires_at, s.created_at
      FROM operator_sessions s
      JOIN operator_account a ON a.singleton_id = 1 AND a.account_id = s.account_id
      WHERE s.token_hash = ?
        AND s.revoked_at IS NULL
        AND s.expires_at > ?
        AND s.auth_epoch = a.auth_epoch
    `)
    .get(hash, now) as SqliteOperatorSessionRow | undefined

  if (!row) {
    return null
  }
  return {
    sessionId: row.session_id,
    accountId: row.account_id,
    authEpoch: Number(row.auth_epoch),
    expiresAt: Number(row.expires_at),
    createdAt: Number(row.created_at)
  }
}

export function executeRevokeOperatorSessionSqlite(
  db: DatabaseSync,
  rawToken: string,
  now: number
): boolean {
  const hash = sha256Base64Url(rawToken)
  const row = db
    .prepare('SELECT session_id, revoked_at FROM operator_sessions WHERE token_hash = ?')
    .get(hash) as { session_id: string; revoked_at: number | null } | undefined
  if (!row) {
    return false
  }
  if (row.revoked_at === null) {
    db.prepare('UPDATE operator_sessions SET revoked_at = ? WHERE session_id = ?').run(
      now,
      row.session_id
    )
  }
  return true
}
