import { randomBytes } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type {
  SecurityStateIssueRefreshTokenInput,
  SecurityStateLookupRefreshTokenResult,
  SecurityStateRotateRefreshTokenInput,
  SecurityStateIssuedAccessSession
} from './own-mobile-relay-security-state'
import { sha256Base64Url } from './own-mobile-relay-security-state-device-cleanup'
import type { SqliteSessionRow } from './own-mobile-relay-security-state-sqlite-session-ops'

export type SqliteRefreshTokenRow = {
  token_hash: string
  session_id: string
  account_id: string
  auth_epoch: number
  expires_at: number | null
  created_at: number
  revoked_at: number | null
}

export function executeIssueRefreshTokenSqlite(
  db: DatabaseSync,
  input: SecurityStateIssueRefreshTokenInput,
  now: number
): void {
  db.exec('BEGIN IMMEDIATE;')
  try {
    const acc = db
      .prepare('SELECT account_id, auth_epoch FROM operator_account WHERE singleton_id = 1')
      .get() as { account_id: string; auth_epoch: number } | undefined
    if (!acc) {
      throw new Error('account_not_initialized')
    }

    const session = db
      .prepare(`
        SELECT session_id FROM access_sessions
        WHERE session_id = ?
          AND revoked_at IS NULL
          AND expires_at > ?
          AND auth_epoch = ?
      `)
      .get(input.sessionId, now, acc.auth_epoch)
    if (!session) {
      throw new Error('invalid_session')
    }

    const tokenHash = sha256Base64Url(input.rawRefreshToken)
    const expiresAt = input.ttlMs !== null ? now + input.ttlMs : null

    db.prepare(`
      INSERT INTO refresh_tokens (
        token_hash, session_id, account_id, auth_epoch, expires_at, created_at, revoked_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, NULL
      )
    `).run(
      tokenHash,
      input.sessionId,
      acc.account_id,
      acc.auth_epoch,
      expiresAt,
      now
    )

    db.exec('COMMIT;')
  } catch (err) {
    db.exec('ROLLBACK;')
    throw err
  }
}

export function executeLookupRefreshTokenSqlite(
  db: DatabaseSync,
  rawRefreshToken: string,
  now: number
): SecurityStateLookupRefreshTokenResult | null {
  const hash = sha256Base64Url(rawRefreshToken)
  const row = db
    .prepare(`
      SELECT r.token_hash, r.session_id, r.expires_at, s.cloud_profile_id
      FROM refresh_tokens r
      JOIN operator_account a ON a.singleton_id = 1 AND a.account_id = r.account_id
      JOIN access_sessions s ON s.session_id = r.session_id
      WHERE r.token_hash = ?
        AND r.revoked_at IS NULL
        AND (r.expires_at IS NULL OR r.expires_at > ?)
        AND r.auth_epoch = a.auth_epoch
        AND s.revoked_at IS NULL
        AND s.auth_epoch = a.auth_epoch
    `)
    .get(hash, now) as { token_hash: string; session_id: string; expires_at: number | null; cloud_profile_id: string } | undefined

  if (!row) {
    return null
  }

  return {
    sessionId: row.session_id,
    cloudProfileId: row.cloud_profile_id,
    expiresAt: row.expires_at !== null ? Number(row.expires_at) : null
  }
}

export function executeRotateRefreshTokenSqlite(
  db: DatabaseSync,
  input: SecurityStateRotateRefreshTokenInput,
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

    const oldTokenHash = sha256Base64Url(input.oldRawRefreshToken)
    const oldRefresh = db
      .prepare(`
        SELECT r.token_hash, r.session_id, r.account_id, r.auth_epoch
        FROM refresh_tokens r
        WHERE r.token_hash = ?
          AND r.revoked_at IS NULL
          AND (r.expires_at IS NULL OR r.expires_at > ?)
          AND r.auth_epoch = ?
      `)
      .get(oldTokenHash, now, acc.auth_epoch) as SqliteRefreshTokenRow | undefined

    if (!oldRefresh) {
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
          AND auth_epoch = ?
      `)
      .get(oldRefresh.session_id, acc.auth_epoch) as SqliteSessionRow | undefined

    if (!oldSession) {
      db.exec('ROLLBACK;')
      return null
    }

    // Revoke old refresh token
    db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ?').run(
      now,
      oldTokenHash
    )

    // Revoke old session
    db.prepare('UPDATE access_sessions SET revoked_at = ? WHERE session_id = ?').run(
      now,
      oldSession.session_id
    )

    // Create new session
    const newSessionId = randomBytes(16).toString('base64url')
    const newAccessTokenHash = sha256Base64Url(input.newRawAccessToken)
    const newExpiresAt = now + input.accessTtlMs

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

    // Create new refresh token
    const newTokenHash = sha256Base64Url(input.newRawRefreshToken)
    const newRefreshExpiresAt = input.refreshTtlMs !== null ? now + input.refreshTtlMs : null

    db.prepare(`
      INSERT INTO refresh_tokens (
        token_hash, session_id, account_id, auth_epoch, expires_at, created_at, revoked_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, NULL
      )
    `).run(
      newTokenHash,
      newSessionId,
      acc.account_id,
      acc.auth_epoch,
      newRefreshExpiresAt,
      now
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

export function executeRevokeRefreshTokensForSessionSqlite(
  db: DatabaseSync,
  sessionId: string,
  now: number
): void {
  db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE session_id = ? AND revoked_at IS NULL').run(
    now,
    sessionId
  )
}

export function executeIsHostKeyExpiryDisabledSqlite(
  db: DatabaseSync,
  relayHostId: string
): boolean {
  const row = db
    .prepare('SELECT key_expiry_disabled FROM host_key_expiry WHERE relay_host_id = ?')
    .get(relayHostId) as { key_expiry_disabled: number } | undefined
  if (!row) {
    return true
  }
  return Number(row.key_expiry_disabled) === 1
}

export function executeSetHostKeyExpiryDisabledSqlite(
  db: DatabaseSync,
  relayHostId: string,
  disabled: boolean,
  now: number
): void {
  db.exec('BEGIN IMMEDIATE;')
  try {
    db.prepare(`
      INSERT INTO host_key_expiry (relay_host_id, key_expiry_disabled, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(relay_host_id) DO UPDATE SET
        key_expiry_disabled = excluded.key_expiry_disabled,
        updated_at = excluded.updated_at
    `).run(relayHostId, disabled ? 1 : 0, now)

    if (!disabled) {
      // If enabling key expiry (disabled=false), fail closed: revoke refresh tokens for that host's parent sessions
      db.prepare(`
        UPDATE refresh_tokens SET revoked_at = ?
        WHERE session_id IN (
          SELECT parent_session_id FROM relay_grants WHERE relay_host_id = ? AND revoked_at IS NULL
        ) AND revoked_at IS NULL
      `).run(now, relayHostId)
    }
    db.exec('COMMIT;')
  } catch (err) {
    db.exec('ROLLBACK;')
    throw err
  }
}

export function executeIsDeviceKeyExpiryDisabledSqlite(
  db: DatabaseSync,
  relayHostId: string,
  relayDeviceId: string
): boolean {
  const row = db
    .prepare('SELECT key_expiry_disabled FROM device_credentials WHERE relay_host_id = ? AND relay_device_id = ?')
    .get(relayHostId, relayDeviceId) as { key_expiry_disabled: number } | undefined
  if (!row) {
    return true
  }
  return Number(row.key_expiry_disabled) === 1
}

export function executeSetDeviceKeyExpiryDisabledSqlite(
  db: DatabaseSync,
  relayHostId: string,
  relayDeviceId: string,
  disabled: boolean
): void {
  db.prepare(`
    UPDATE device_credentials SET key_expiry_disabled = ?
    WHERE relay_host_id = ? AND relay_device_id = ?
  `).run(disabled ? 1 : 0, relayHostId, relayDeviceId)
}
