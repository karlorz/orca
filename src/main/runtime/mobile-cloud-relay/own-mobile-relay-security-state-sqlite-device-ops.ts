import type { DatabaseSync } from 'node:sqlite'
import type {
  SecurityStateDeviceInstallInput,
  SecurityStateDeviceInstallResult,
  SecurityStateDeviceInstallStatusResult,
  SecurityStateDeviceMatchResult,
  SecurityStateDeviceCredential
} from './own-mobile-relay-security-state'
import { RESUME_TOKEN_TTL_MS, GRACE_TOKEN_TTL_MS } from './own-mobile-relay-types'
import { sqliteKeyExpiryDisabled } from './own-mobile-relay-security-state-sqlite-schema'

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
  key_expiry_disabled?: number | null
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

    const keyExpiryDisabled = sqliteKeyExpiryDisabled(existing?.key_expiry_disabled) ? 1 : 0

    db.prepare(`
      INSERT INTO device_credentials (
        relay_host_id, relay_device_id, last_install_req_id,
        current_resume_token_hash, current_version, resume_expires_at,
        authorization_mode, grace_resume_token_hash, grace_expires_at, revoked_at,
        key_expiry_disabled
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?
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
      graceExpiresAt,
      keyExpiryDisabled
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
             authorization_mode, grace_resume_token_hash, grace_expires_at, revoked_at,
             key_expiry_disabled
      FROM device_credentials
      WHERE relay_host_id = ?
        AND revoked_at IS NULL
        AND (
          (current_resume_token_hash = ? AND (COALESCE(key_expiry_disabled, 1) = 1 OR resume_expires_at > ?))
          OR (grace_resume_token_hash = ? AND grace_expires_at IS NOT NULL AND (COALESCE(key_expiry_disabled, 1) = 1 OR grace_expires_at > ?))
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

  const keyExpiryDisabled = sqliteKeyExpiryDisabled(row.key_expiry_disabled)

  if (
    row.current_resume_token_hash === tokenHash &&
    (keyExpiryDisabled || Number(row.resume_expires_at) > now)
  ) {
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
