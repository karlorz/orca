import type { DatabaseSync } from 'node:sqlite'
import type { SecurityStateCleanupResult } from './own-mobile-relay-security-state'

export function executeCleanupExpiredSqlite(
  db: DatabaseSync,
  maxBatchSize: number,
  now: number
): SecurityStateCleanupResult {
  db.exec('BEGIN IMMEDIATE;')
  try {
    // Revoke/delete stale refresh tokens where token's or session's auth_epoch mismatches the account's auth_epoch,
    // or where the account is not active, or where the refresh token has expired
    db.prepare(`
      DELETE FROM refresh_tokens
      WHERE token_hash IN (
        SELECT r.token_hash
        FROM refresh_tokens r
        JOIN operator_account a ON a.account_id = r.account_id
        JOIN access_sessions s ON s.session_id = r.session_id
        WHERE r.revoked_at IS NOT NULL
           OR (r.expires_at IS NOT NULL AND r.expires_at <= ?)
           OR a.status != 'active'
           OR r.auth_epoch != a.auth_epoch
           OR s.auth_epoch != a.auth_epoch
      )
    `).run(now)

    let remainingBudget = maxBatchSize
    let expiredSessionsDeleted = 0
    let expiredGrantsDeleted = 0
    let expiredDevicesDeleted = 0

    // 1. Clean up invalid/expired sessions up to remainingBudget
    // A session is invalid if revoked, expired (and not kept by a valid refresh token), or epoch mismatched
    if (remainingBudget > 0) {
      const expiredSessionIds = (
        db
          .prepare(`
            SELECT s.session_id FROM access_sessions s
            LEFT JOIN operator_account a ON a.account_id = s.account_id
            WHERE (
              s.revoked_at IS NOT NULL
              OR a.account_id IS NULL
              OR a.status != 'active'
              OR s.auth_epoch != a.auth_epoch
              OR (
                s.expires_at <= ?
                AND s.session_id NOT IN (
                  SELECT r.session_id FROM refresh_tokens r
                  JOIN operator_account ra ON ra.account_id = r.account_id
                  WHERE r.revoked_at IS NULL
                    AND (r.expires_at IS NULL OR r.expires_at > ?)
                    AND ra.status = 'active'
                    AND r.auth_epoch = ra.auth_epoch
                )
              )
            )
            LIMIT ?
          `)
          .all(now, now, remainingBudget) as { session_id: string }[]
      ).map((r) => r.session_id)

      if (expiredSessionIds.length > 0) {
        const placeholders = expiredSessionIds.map(() => '?').join(',')
        db.prepare(`DELETE FROM access_sessions WHERE session_id IN (${placeholders})`).run(
          ...expiredSessionIds
        )
        expiredSessionsDeleted = expiredSessionIds.length
        remainingBudget -= expiredSessionsDeleted
      }
    }

    // 2. Clean up invalid/expired grants up to remainingBudget
    if (remainingBudget > 0) {
      const expiredGrantIds = (
        db
          .prepare(`
            SELECT g.grant_id FROM relay_grants g
            LEFT JOIN operator_account a ON a.account_id = g.account_id
            LEFT JOIN access_sessions s ON s.session_id = g.parent_session_id
            WHERE g.revoked_at IS NOT NULL
               OR a.account_id IS NULL
               OR a.status != 'active'
               OR g.expires_at <= ?
               OR g.auth_epoch != a.auth_epoch
               OR s.session_id IS NULL
               OR s.revoked_at IS NOT NULL
               OR s.expires_at <= ?
               OR s.auth_epoch != a.auth_epoch
            LIMIT ?
          `)
          .all(now, now, remainingBudget) as { grant_id: string }[]
      ).map((r) => r.grant_id)

      if (expiredGrantIds.length > 0) {
        const placeholders = expiredGrantIds.map(() => '?').join(',')
        db.prepare(`DELETE FROM relay_grants WHERE grant_id IN (${placeholders})`).run(
          ...expiredGrantIds
        )
        expiredGrantsDeleted = expiredGrantIds.length
        remainingBudget -= expiredGrantsDeleted
      }
    }

    // 3. Clean up expired/revoked device credentials up to remainingBudget
    if (remainingBudget > 0) {
      const expiredDevices = db
        .prepare(`
          SELECT relay_host_id, relay_device_id FROM device_credentials
          WHERE revoked_at IS NOT NULL
             OR (
               COALESCE(key_expiry_disabled, 1) = 0
               AND resume_expires_at <= ?
               AND (grace_expires_at IS NULL OR grace_expires_at <= ?)
             )
          LIMIT ?
        `)
        .all(now, now, remainingBudget) as {
        relay_host_id: string
        relay_device_id: string
      }[]

      if (expiredDevices.length > 0) {
        const placeholders = expiredDevices.map(() => '(?, ?)').join(',')
        db.prepare(
          `DELETE FROM device_credentials WHERE (relay_host_id, relay_device_id) IN (${placeholders})`
        ).run(...expiredDevices.flatMap((dev) => [dev.relay_host_id, dev.relay_device_id]))
        expiredDevicesDeleted = expiredDevices.length
        remainingBudget -= expiredDevicesDeleted
      }
    }

    db.exec('COMMIT;')
    return {
      expiredSessionsDeleted,
      expiredGrantsDeleted,
      expiredDevicesDeleted
    }
  } catch (err) {
    db.exec('ROLLBACK;')
    throw err
  }
}
