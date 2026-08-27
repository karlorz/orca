import { randomBytes } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type {
  SecurityStateAccessSession,
  SecurityStateIssueAccessSessionInput,
  SecurityStateIssuedAccessSession,
  SecurityStateReplaceAccessSessionInput
} from './own-mobile-relay-security-state'
import { sha256Base64Url } from './own-mobile-relay-security-state-device-cleanup'

export type SqliteSessionRow = {
  session_id: string
  account_id: string
  access_token_hash: string
  auth_epoch: number
  expires_at: number
  created_at: number
  revoked_at: number | null
  user_id: string
  profile_id: string
  organization_id: string
  email: string
  cloud_profile_id: string
}

export function executeIssueAccessSessionSqlite(
  db: DatabaseSync,
  input: SecurityStateIssueAccessSessionInput,
  now: number
): SecurityStateIssuedAccessSession {
  db.exec('BEGIN IMMEDIATE;')
  try {
    const acc = db
      .prepare('SELECT account_id, auth_epoch FROM operator_account WHERE singleton_id = 1')
      .get() as { account_id: string; auth_epoch: number } | undefined
    if (!acc) {
      throw new Error('account_not_initialized')
    }
    if (
      (input.expectedAccountId !== undefined && acc.account_id !== input.expectedAccountId) ||
      (input.expectedAuthEpoch !== undefined && Number(acc.auth_epoch) !== input.expectedAuthEpoch)
    ) {
      throw new Error('account_epoch_mismatch')
    }
    const sessionId = randomBytes(16).toString('base64url')
    const accessTokenHash = sha256Base64Url(input.rawAccessToken)
    const expiresAt = now + input.ttlMs

    const stmt = db.prepare(`
      INSERT INTO access_sessions (
        session_id, account_id, access_token_hash, auth_epoch,
        expires_at, created_at, revoked_at, user_id, profile_id,
        organization_id, email, cloud_profile_id
      ) VALUES (
        ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?
      )
    `)
    stmt.run(
      sessionId,
      acc.account_id,
      accessTokenHash,
      acc.auth_epoch,
      expiresAt,
      now,
      input.identity.userId,
      input.identity.profileId,
      input.identity.organizationId,
      input.identity.email,
      input.identity.cloudProfileId
    )
    db.exec('COMMIT;')
    return {
      sessionId,
      accountId: acc.account_id,
      authEpoch: Number(acc.auth_epoch),
      expiresAt,
      identity: input.identity
    }
  } catch (err) {
    db.exec('ROLLBACK;')
    throw err
  }
}

export function executeLookupAccessSessionByTokenSqlite(
  db: DatabaseSync,
  rawAccessToken: string,
  now: number
): SecurityStateAccessSession | null {
  const hash = sha256Base64Url(rawAccessToken)
  const row = db
    .prepare(`
      SELECT s.session_id, s.account_id, s.auth_epoch, s.expires_at, s.created_at,
             s.user_id, s.profile_id, s.organization_id, s.email, s.cloud_profile_id
      FROM access_sessions s
      JOIN operator_account a ON a.singleton_id = 1 AND a.account_id = s.account_id
      WHERE s.access_token_hash = ?
        AND s.revoked_at IS NULL
        AND s.expires_at > ?
        AND s.auth_epoch = a.auth_epoch
    `)
    .get(hash, now) as SqliteSessionRow | undefined

  if (!row) {
    return null
  }
  return {
    sessionId: row.session_id,
    accountId: row.account_id,
    authEpoch: Number(row.auth_epoch),
    expiresAt: Number(row.expires_at),
    createdAt: Number(row.created_at),
    identity: {
      userId: row.user_id,
      profileId: row.profile_id,
      organizationId: row.organization_id,
      email: row.email,
      cloudProfileId: row.cloud_profile_id
    }
  }
}

export function executeReplaceAccessSessionSqlite(
  db: DatabaseSync,
  input: SecurityStateReplaceAccessSessionInput,
  now: number
): SecurityStateIssuedAccessSession | null {
  db.exec('BEGIN IMMEDIATE;')
  try {
    const acc = db
      .prepare('SELECT account_id, auth_epoch FROM operator_account WHERE singleton_id = 1')
      .get() as { account_id: string; auth_epoch: number } | undefined
    if (!acc) {
      db.exec('ROLLBACK;')
      return null
    }

    const oldSession = db
      .prepare(`
        SELECT session_id, account_id, auth_epoch, expires_at, created_at,
               user_id, profile_id, organization_id, email, cloud_profile_id
        FROM access_sessions
        WHERE session_id = ?
          AND revoked_at IS NULL
          AND expires_at > ?
          AND auth_epoch = ?
      `)
      .get(input.oldSessionId, now, acc.auth_epoch) as SqliteSessionRow | undefined

    if (!oldSession) {
      db.exec('ROLLBACK;')
      return null
    }

    // Revoke old session
    db.prepare('UPDATE access_sessions SET revoked_at = ? WHERE session_id = ?').run(
      now,
      input.oldSessionId
    )

    // Issue new session
    const newSessionId = randomBytes(16).toString('base64url')
    const newAccessTokenHash = sha256Base64Url(input.newRawAccessToken)
    const newExpiresAt = now + input.ttlMs

    db.prepare(`
      INSERT INTO access_sessions (
        session_id, account_id, access_token_hash, auth_epoch,
        expires_at, created_at, revoked_at, user_id, profile_id,
        organization_id, email, cloud_profile_id
      ) VALUES (
        ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?
      )
    `).run(
      newSessionId,
      acc.account_id,
      newAccessTokenHash,
      acc.auth_epoch,
      newExpiresAt,
      now,
      oldSession.user_id,
      oldSession.profile_id,
      oldSession.organization_id,
      oldSession.email,
      oldSession.cloud_profile_id
    )

    db.exec('COMMIT;')
    return {
      sessionId: newSessionId,
      accountId: acc.account_id,
      authEpoch: Number(acc.auth_epoch),
      expiresAt: newExpiresAt,
      identity: {
        userId: oldSession.user_id,
        profileId: oldSession.profile_id,
        organizationId: oldSession.organization_id,
        email: oldSession.email,
        cloudProfileId: oldSession.cloud_profile_id
      }
    }
  } catch (err) {
    db.exec('ROLLBACK;')
    throw err
  }
}

export function executeRevokeAccessSessionByIdSqlite(
  db: DatabaseSync,
  sessionId: string,
  now: number
): boolean {
  const row = db
    .prepare('SELECT session_id, revoked_at FROM access_sessions WHERE session_id = ?')
    .get(sessionId) as { session_id: string; revoked_at: number | null } | undefined
  if (!row) {
    return false
  }
  if (row.revoked_at === null) {
    db.prepare('UPDATE access_sessions SET revoked_at = ? WHERE session_id = ?').run(now, sessionId)
  }
  return true
}

export function executeRevokeAccessSessionByTokenSqlite(
  db: DatabaseSync,
  rawAccessToken: string,
  now: number
): boolean {
  const hash = sha256Base64Url(rawAccessToken)
  const row = db
    .prepare('SELECT session_id, revoked_at FROM access_sessions WHERE access_token_hash = ?')
    .get(hash) as { session_id: string; revoked_at: number | null } | undefined
  if (!row) {
    return false
  }
  if (row.revoked_at === null) {
    db.prepare('UPDATE access_sessions SET revoked_at = ? WHERE session_id = ?').run(
      now,
      row.session_id
    )
  }
  return true
}
