import type { DatabaseSync } from 'node:sqlite'
import type {
  SecurityStateDeviceInstallInput,
  SecurityStateDeviceInstallResult,
  SecurityStateDeviceInstallStatusResult,
  SecurityStateDeviceMatchResult,
  SecurityStateCleanupResult,
  SecurityStateDeviceCredential
} from './own-mobile-relay-security-state'
import { RESUME_TOKEN_TTL_MS, GRACE_TOKEN_TTL_MS } from './own-mobile-relay-types'

export type SqliteDeviceRow = {
  relay_host_id: string
  relay_device_id: string
  last_install_req_id: string
  current_resume_token_hash: string
  current_version: number
  resume_expires_at: number
  authorization_mode: 'relay-basis' | 'authenticated-direct'
  grace_resume_token_hash: string | null
  grace_expires_at: number | null
  revoked_at: number | null
}

export function executeInstallDeviceCredentialSqlite(
  db: DatabaseSync,
  input: SecurityStateDeviceInstallInput,
  now: number
): SecurityStateDeviceInstallResult {
  if (!/^[A-Za-z0-9_-]{43}$/.test(input.newResumeTokenHash)) {
    return { ok: false, code: 'invalid_token_hash' }
  }
  if (
    input.authorizationMode !== 'relay-basis' &&
    input.authorizationMode !== 'authenticated-direct'
  ) {
    return { ok: false, code: 'invalid_authorization' }
  }

  db.exec('BEGIN IMMEDIATE;')
  try {
    const existing = db
      .prepare(`
        SELECT relay_host_id, relay_device_id, last_install_req_id,
               current_resume_token_hash, current_version, resume_expires_at,
               authorization_mode, grace_resume_token_hash, grace_expires_at, revoked_at
        FROM device_credentials
        WHERE relay_host_id = ? AND relay_device_id = ?
      `)
      .get(input.relayHostId, input.relayDeviceId) as SqliteDeviceRow | undefined

    if (
      input.expectedCurrentHash !== undefined &&
      existing?.current_resume_token_hash !== input.expectedCurrentHash
    ) {
      db.exec('ROLLBACK;')
      return { ok: false, code: 'hash-mismatch' }
    }

    const currentVersion = existing ? Number(existing.current_version) + 1 : 1
    const resumeTtl = input.resumeTtlMs ?? RESUME_TOKEN_TTL_MS
    const graceTtl = input.graceTtlMs ?? GRACE_TOKEN_TTL_MS
    const resumeExpiresAt = now + resumeTtl

    let graceHash: string | null = null
    let graceExpiresAt: number | null = null

    if (existing) {
      graceHash = existing.current_resume_token_hash
      graceExpiresAt = now + graceTtl
    }

    db.prepare(`
      INSERT INTO device_credentials (
        relay_host_id, relay_device_id, last_install_req_id,
        current_resume_token_hash, current_version, resume_expires_at,
        authorization_mode, grace_resume_token_hash, grace_expires_at, revoked_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL
      )
      ON CONFLICT(relay_host_id, relay_device_id) DO UPDATE SET
        last_install_req_id = excluded.last_install_req_id,
        current_resume_token_hash = excluded.current_resume_token_hash,
        current_version = excluded.current_version,
        resume_expires_at = excluded.resume_expires_at,
        authorization_mode = excluded.authorization_mode,
        grace_resume_token_hash = excluded.grace_resume_token_hash,
        grace_expires_at = excluded.grace_expires_at,
        revoked_at = NULL
    `).run(
      input.relayHostId,
      input.relayDeviceId,
      input.reqId,
      input.newResumeTokenHash,
      currentVersion,
      resumeExpiresAt,
      input.authorizationMode,
      graceHash,
      graceExpiresAt
    )

    db.exec('COMMIT;')
    return {
      ok: true,
      installed: {
        v: 1,
        reqId: input.reqId,
        authorizationMode: input.authorizationMode,
        currentVersion,
        resumeExpiresAt,
        ...(graceExpiresAt !== null ? { graceExpiresAt } : {})
      }
    }
  } catch (err) {
    db.exec('ROLLBACK;')
    throw err
  }
}

export function executeGetDeviceCredentialInstallStatusSqlite(
  db: DatabaseSync,
  relayHostId: string,
  relayDeviceId: string,
  reqId: string
): SecurityStateDeviceInstallStatusResult {
  const row = db
    .prepare(`
      SELECT relay_host_id, relay_device_id, last_install_req_id,
             current_resume_token_hash, current_version, resume_expires_at,
             authorization_mode, grace_resume_token_hash, grace_expires_at, revoked_at
      FROM device_credentials
      WHERE relay_host_id = ? AND relay_device_id = ?
    `)
    .get(relayHostId, relayDeviceId) as SqliteDeviceRow | undefined

  if (!row || row.revoked_at !== null) {
    return { v: 1, reqId, state: 'not-found' }
  }

  return {
    v: 1,
    reqId,
    state: 'committed',
    result: {
      v: 1,
      reqId: row.last_install_req_id,
      authorizationMode: row.authorization_mode,
      currentVersion: Number(row.current_version),
      resumeExpiresAt: Number(row.resume_expires_at),
      ...(row.grace_expires_at !== null ? { graceExpiresAt: Number(row.grace_expires_at) } : {})
    }
  }
}

export function executeMatchDeviceCredentialSqlite(
  db: DatabaseSync,
  relayHostId: string,
  tokenHash: string,
  now: number
): SecurityStateDeviceMatchResult | null {
  const row = db
    .prepare(`
      SELECT relay_host_id, relay_device_id, last_install_req_id,
             current_resume_token_hash, current_version, resume_expires_at,
             authorization_mode, grace_resume_token_hash, grace_expires_at, revoked_at
      FROM device_credentials
      WHERE relay_host_id = ?
        AND revoked_at IS NULL
        AND (
          (current_resume_token_hash = ? AND resume_expires_at > ?)
          OR (grace_resume_token_hash = ? AND grace_expires_at IS NOT NULL AND grace_expires_at > ?)
        )
    `)
    .get(relayHostId, tokenHash, now, tokenHash, now) as SqliteDeviceRow | undefined

  if (!row) {
    return null
  }

  const base: SecurityStateDeviceCredential = {
    relayHostId: row.relay_host_id,
    relayDeviceId: row.relay_device_id,
    lastInstallReqId: row.last_install_req_id,
    currentVersion: Number(row.current_version),
    resumeExpiresAt: Number(row.resume_expires_at),
    authorizationMode: row.authorization_mode,
    ...(row.grace_expires_at !== null ? { graceExpiresAt: Number(row.grace_expires_at) } : {})
  }

  if (row.current_resume_token_hash === tokenHash && Number(row.resume_expires_at) > now) {
    return { device: base, acceptedAs: 'current' }
  }
  if (
    row.grace_resume_token_hash === tokenHash &&
    row.grace_expires_at !== null &&
    Number(row.grace_expires_at) > now
  ) {
    return { device: base, acceptedAs: 'grace' }
  }
  return null
}

export function executeRevokeDeviceCredentialSqlite(
  db: DatabaseSync,
  relayHostId: string,
  relayDeviceId: string,
  now: number
): boolean {
  const row = db
    .prepare(
      'SELECT revoked_at FROM device_credentials WHERE relay_host_id = ? AND relay_device_id = ?'
    )
    .get(relayHostId, relayDeviceId) as { revoked_at: number | null } | undefined

  if (!row || row.revoked_at !== null) {
    return false
  }

  db.prepare(
    'UPDATE device_credentials SET revoked_at = ? WHERE relay_host_id = ? AND relay_device_id = ?'
  ).run(now, relayHostId, relayDeviceId)
  return true
}

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
            WHERE revoked_at IS NOT NULL
               OR expires_at <= ?
               OR auth_epoch != ?
            LIMIT ?
          `)
          .all(now, currentEpoch, remainingBudget) as { session_id: string }[]
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
             OR (resume_expires_at <= ? AND (grace_expires_at IS NULL OR grace_expires_at <= ?))
          LIMIT ?
        `)
        .all(now, now, remainingBudget) as {
        relay_host_id: string
        relay_device_id: string
      }[]

      if (expiredDevices.length > 0) {
        const delStmt = db.prepare(
          'DELETE FROM device_credentials WHERE relay_host_id = ? AND relay_device_id = ?'
        )
        for (const dev of expiredDevices) {
          delStmt.run(dev.relay_host_id, dev.relay_device_id)
        }
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
