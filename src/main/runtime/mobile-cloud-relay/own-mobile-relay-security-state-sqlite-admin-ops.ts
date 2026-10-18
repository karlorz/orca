import { randomBytes } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { PasswordRecord } from './own-mobile-relay-password'
import type { SecurityStateAccountIdentity } from './own-mobile-relay-security-state'
import {
  mapAccountRow,
  type SqliteAccountRow
} from './own-mobile-relay-security-state-sqlite-account-ops'

export function executeInviteAccountSqlite(
  db: DatabaseSync,
  input: { email: string; userId: string; profileId: string; organizationId: string },
  now: number
): SecurityStateAccountIdentity {
  const accountId = randomBytes(16).toString('base64url')
  const stmt = db.prepare(`
    INSERT INTO operator_account (
      account_id, email, user_id, profile_id, organization_id,
      role, status, verifier_version, auth_epoch,
      password_version, password_verifier, password_salt,
      param_n, param_r, param_p, param_key_len, param_maxmem,
      created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, 'user', 'invited', 1, 1,
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      ?, ?
    )
  `)
  stmt.run(
    accountId,
    input.email.toLowerCase(),
    input.userId,
    input.profileId,
    input.organizationId,
    now,
    now
  )
  return {
    accountId,
    email: input.email.toLowerCase(),
    userId: input.userId,
    profileId: input.profileId,
    organizationId: input.organizationId,
    role: 'user',
    status: 'invited',
    verifierVersion: 1,
    authEpoch: 1,
    createdAt: now,
    updatedAt: now
  }
}

export function executeActivateInvitedAccountSqlite(
  db: DatabaseSync,
  accountId: string,
  record: PasswordRecord,
  now: number
): 'ok' | 'conflict' {
  db.exec('BEGIN IMMEDIATE;')
  try {
    const existing = db
      .prepare('SELECT account_id, status FROM operator_account WHERE account_id = ?')
      .get(accountId) as Pick<SqliteAccountRow, 'account_id' | 'status'> | undefined
    if (!existing || existing.status !== 'invited') {
      db.exec('ROLLBACK;')
      return 'conflict'
    }
    const updateStmt = db.prepare(`
      UPDATE operator_account
      SET status = 'active',
          password_version = ?,
          password_verifier = ?,
          password_salt = ?,
          param_n = ?,
          param_r = ?,
          param_p = ?,
          param_key_len = ?,
          param_maxmem = ?,
          updated_at = ?
      WHERE account_id = ? AND status = 'invited'
    `)
    const res = updateStmt.run(
      record.version,
      record.verifier,
      record.salt,
      record.params.N,
      record.params.r,
      record.params.p,
      record.params.keyLen,
      record.params.maxmem,
      now,
      accountId
    )
    if (res.changes === 0) {
      db.exec('ROLLBACK;')
      return 'conflict'
    }
    db.exec('COMMIT;')
    return 'ok'
  } catch (err) {
    db.exec('ROLLBACK;')
    throw err
  }
}

export function executeGetAdminAccountSqlite(
  db: DatabaseSync,
  email?: string
): SecurityStateAccountIdentity | null {
  const row = (
    email
      ? db
          .prepare(
            `SELECT account_id, email, user_id, profile_id, organization_id,
                    role, status, verifier_version, auth_epoch, created_at, updated_at
             FROM operator_account WHERE role = 'admin' AND lower(email) = lower(?) LIMIT 1`
          )
          .get(email)
      : db
          .prepare(
            `SELECT account_id, email, user_id, profile_id, organization_id,
                    role, status, verifier_version, auth_epoch, created_at, updated_at
             FROM operator_account WHERE role = 'admin' LIMIT 1`
          )
          .get()
  ) as SqliteAccountRow | undefined
  return row ? mapAccountRow(row) : null
}

export function executeHasAdminAccountSqlite(db: DatabaseSync): boolean {
  return Boolean(db.prepare("SELECT 1 FROM operator_account WHERE role = 'admin' LIMIT 1").get())
}

export function executeDisableAccountSqlite(
  db: DatabaseSync,
  accountId: string,
  now: number
): 'ok' | 'last_admin' {
  db.exec('BEGIN IMMEDIATE;')
  try {
    const target = db
      .prepare(
        'SELECT account_id, role, status, auth_epoch FROM operator_account WHERE account_id = ?'
      )
      .get(accountId) as
      | Pick<SqliteAccountRow, 'account_id' | 'role' | 'status' | 'auth_epoch'>
      | undefined
    if (!target || target.status !== 'active') {
      db.exec('COMMIT;')
      return 'ok'
    }
    if (target.role === 'admin') {
      const adminCountRow = db
        .prepare(
          "SELECT count(*) as cnt FROM operator_account WHERE role = 'admin' AND status != 'disabled'"
        )
        .get() as { cnt: number | bigint } | undefined
      const adminCount = Number(adminCountRow?.cnt ?? 0)
      if (adminCount <= 1) {
        db.exec('ROLLBACK;')
        return 'last_admin'
      }
    }
    const updateStmt = db.prepare(`
      UPDATE operator_account
      SET status = 'disabled',
          auth_epoch = auth_epoch + 1,
          updated_at = ?
      WHERE account_id = ?
    `)
    updateStmt.run(now, accountId)
    db.exec('COMMIT;')
    return 'ok'
  } catch (err) {
    db.exec('ROLLBACK;')
    throw err
  }
}

export function executeListAccountsSqlite(db: DatabaseSync): SecurityStateAccountIdentity[] {
  const rows = db
    .prepare(
      `SELECT account_id, email, user_id, profile_id, organization_id,
              role, status, verifier_version, auth_epoch, created_at, updated_at
       FROM operator_account
       ORDER BY created_at ASC`
    )
    .all() as SqliteAccountRow[]
  return rows.map(mapAccountRow)
}
