import type { DatabaseSync } from 'node:sqlite'
import type { SecurityStateCleanupResult } from './own-mobile-relay-security-state'

export function executeCleanupExpiredSqlite(
  db: DatabaseSync,
  maxBatchSize: number,
  now: number
): SecurityStateCleanupResult {
  db.exec('BEGIN IMMEDIATE;')
  try {
    const acc = db
      .prepare('SELECT auth_epoch FROM operator_account WHERE singleton_id = 1')
      .get() as { auth_epoch: number } | undefined
    const currentEpoch = acc ? Number(acc.auth_epoch) : -1

    let remainingBudget = maxBatchSize
    let expiredSessionsDeleted = 0
    let expiredGrantsDeleted = 0
    let expiredDevicesDeleted = 0

    // 1. Clean up invalid/expired sessions up to remainingBudget
    if (remainingBudget > 0) {
      const expiredSessionIds = (
        db
          .prepare(`
            SELECT session_id FROM access_sessions
            WHERE (revoked_at IS NOT NULL
               OR expires_at <= ?
               OR auth_epoch != ?)
              AND session_id NOT IN (
                SELECT session_id FROM refresh_tokens
                WHERE revoked_at IS NULL
                  AND (expires_at IS NULL OR expires_at > ?)
              )
            LIMIT ?
          `)
          .all(now, currentEpoch, now, remainingBudget) as { session_id: string }[]
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
            LEFT JOIN access_sessions s ON s.session_id = g.parent_session_id
            WHERE g.revoked_at IS NOT NULL
               OR g.expires_at <= ?
               OR g.auth_epoch != ?
               OR s.session_id IS NULL
               OR s.revoked_at IS NOT NULL
               OR s.expires_at <= ?
               OR s.auth_epoch != ?
            LIMIT ?
          `)
          .all(now, currentEpoch, now, currentEpoch, remainingBudget) as { grant_id: string }[]
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
