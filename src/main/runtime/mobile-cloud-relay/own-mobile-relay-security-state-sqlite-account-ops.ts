import { randomBytes } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { PasswordRecord } from './own-mobile-relay-password'
import type {
  SecurityStateAccountBootstrapInput,
  SecurityStateAccountIdentity
} from './own-mobile-relay-security-state'

export type SqliteAccountRow = {
  account_id: string
  email: string
  user_id: string
  profile_id: string
  organization_id: string
  role?: string
  status?: string
  verifier_version: number
  auth_epoch: number
  password_version: number | null
  password_verifier: string | null
  password_salt: string | null
  param_n: number | null
  param_r: number | null
  param_p: number | null
  param_key_len: number | null
  param_maxmem: number | null
  created_at: number
  updated_at: number
}

export function mapAccountRow(row: SqliteAccountRow): SecurityStateAccountIdentity {
  return {
    accountId: row.account_id,
    email: row.email,
    userId: row.user_id,
    profileId: row.profile_id,
    organizationId: row.organization_id,
    role: (row.role ?? 'admin') as 'admin' | 'user',
    status: (row.status ?? 'active') as 'invited' | 'active' | 'disabled',
    verifierVersion: Number(row.verifier_version),
    authEpoch: Number(row.auth_epoch),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  }
}

export function executeGetAccountSqlite(
  db: DatabaseSync,
  selector?: { email?: string; accountId?: string }
): SecurityStateAccountIdentity | null {
  let row: SqliteAccountRow | undefined
  if (selector?.accountId) {
    row = db
      .prepare(
        `SELECT account_id, email, user_id, profile_id, organization_id,
                role, status, verifier_version, auth_epoch, created_at, updated_at
         FROM operator_account WHERE account_id = ? LIMIT 1`
      )
      .get(selector.accountId) as SqliteAccountRow | undefined
  } else if (selector?.email) {
    row = db
      .prepare(
        `SELECT account_id, email, user_id, profile_id, organization_id,
                role, status, verifier_version, auth_epoch, created_at, updated_at
         FROM operator_account WHERE lower(email) = lower(?) LIMIT 1`
      )
      .get(selector.email) as SqliteAccountRow | undefined
  } else {
    row = db
      .prepare(
        `SELECT account_id, email, user_id, profile_id, organization_id,
                role, status, verifier_version, auth_epoch, created_at, updated_at
         FROM operator_account LIMIT 1`
      )
      .get() as SqliteAccountRow | undefined
  }
  return row ? mapAccountRow(row) : null
}

export function executeBootstrapAccountSqlite(
  db: DatabaseSync,
  input: SecurityStateAccountBootstrapInput,
  now: number
): SecurityStateAccountIdentity {
  db.exec('BEGIN IMMEDIATE;')
  try {
    const existing = db
      .prepare("SELECT account_id FROM operator_account WHERE role = 'admin' LIMIT 1")
      .get()
    if (existing) {
      throw new Error('account_already_initialized')
    }
    const accountId = randomBytes(16).toString('base64url')
    const stmt = db.prepare(`
      INSERT INTO operator_account (
        account_id, email, user_id, profile_id, organization_id,
        role, status,
        verifier_version, auth_epoch, password_version, password_verifier,
        password_salt, param_n, param_r, param_p, param_key_len, param_maxmem,
        created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, 'admin', 'active', 1, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `)
    stmt.run(
      accountId,
      input.email.toLowerCase(),
      input.userId,
      input.profileId,
      input.organizationId,
      input.passwordRecord.version,
      input.passwordRecord.verifier,
      input.passwordRecord.salt,
      input.passwordRecord.params.N,
      input.passwordRecord.params.r,
      input.passwordRecord.params.p,
      input.passwordRecord.params.keyLen,
      input.passwordRecord.params.maxmem,
      now,
      now
    )
    db.exec('COMMIT;')
    return {
      accountId,
      email: input.email.toLowerCase(),
      userId: input.userId,
      profileId: input.profileId,
      organizationId: input.organizationId,
      role: 'admin',
      status: 'active',
      verifierVersion: 1,
      authEpoch: 1,
      createdAt: now,
      updatedAt: now
    }
  } catch (err) {
    db.exec('ROLLBACK;')
    throw err
  }
}

export function executeGetAccountPasswordRecordSqlite(
  db: DatabaseSync,
  accountId?: string
): {
  accountId: string
  verifierVersion: number
  authEpoch: number
  passwordRecord: PasswordRecord
} | null {
  const query = accountId
    ? `SELECT account_id, verifier_version, auth_epoch,
              password_version, password_verifier, password_salt,
              param_n, param_r, param_p, param_key_len, param_maxmem
       FROM operator_account WHERE account_id = ?`
    : `SELECT account_id, verifier_version, auth_epoch,
              password_version, password_verifier, password_salt,
              param_n, param_r, param_p, param_key_len, param_maxmem
       FROM operator_account LIMIT 1`
  const row = (accountId ? db.prepare(query).get(accountId) : db.prepare(query).get()) as
    | SqliteAccountRow
    | undefined
  if (
    !row ||
    row.password_version === null ||
    row.password_verifier === null ||
    row.password_salt === null ||
    row.param_n === null ||
    row.param_r === null ||
    row.param_p === null ||
    row.param_key_len === null ||
    row.param_maxmem === null
  ) {
    return null
  }
  const passwordRecord: PasswordRecord = {
    version: Number(row.password_version),
    verifier: row.password_verifier,
    salt: row.password_salt,
    params: {
      N: Number(row.param_n),
      r: Number(row.param_r),
      p: Number(row.param_p),
      keyLen: Number(row.param_key_len),
      maxmem: Number(row.param_maxmem)
    }
  }
  return {
    accountId: row.account_id,
    verifierVersion: Number(row.verifier_version),
    authEpoch: Number(row.auth_epoch),
    passwordRecord
  }
}

function executeMutatePasswordVerifierSqlite(
  db: DatabaseSync,
  accountId: string,
  input: { expectedVerifierVersion: number; newPasswordRecord: PasswordRecord },
  now: number,
  advanceAuthEpoch: boolean
):
  | { ok: true; account: SecurityStateAccountIdentity }
  | { ok: false; error: 'version_mismatch' | 'not_found' | 'not_active' } {
  db.exec('BEGIN IMMEDIATE;')
  try {
    const existing = db
      .prepare(
        `SELECT account_id, email, user_id, profile_id, organization_id,
                role, status, verifier_version, auth_epoch, created_at, updated_at
         FROM operator_account WHERE account_id = ?`
      )
      .get(accountId) as SqliteAccountRow | undefined
    if (!existing) {
      db.exec('ROLLBACK;')
      return { ok: false, error: 'not_found' }
    }
    if (existing.status !== 'active') {
      db.exec('ROLLBACK;')
      return { ok: false, error: 'not_active' }
    }
    if (Number(existing.verifier_version) !== input.expectedVerifierVersion) {
      db.exec('ROLLBACK;')
      return { ok: false, error: 'version_mismatch' }
    }
    const newVerifierVersion = Number(existing.verifier_version) + 1
    const newAuthEpoch = advanceAuthEpoch
      ? Number(existing.auth_epoch) + 1
      : Number(existing.auth_epoch)

    const updateStmt = db.prepare(`
      UPDATE operator_account
      SET verifier_version = ?,
          auth_epoch = ?,
          password_version = ?,
          password_verifier = ?,
          password_salt = ?,
          param_n = ?,
          param_r = ?,
          param_p = ?,
          param_key_len = ?,
          param_maxmem = ?,
          updated_at = ?
      WHERE account_id = ? AND verifier_version = ?
    `)
    const result = updateStmt.run(
      newVerifierVersion,
      newAuthEpoch,
      input.newPasswordRecord.version,
      input.newPasswordRecord.verifier,
      input.newPasswordRecord.salt,
      input.newPasswordRecord.params.N,
      input.newPasswordRecord.params.r,
      input.newPasswordRecord.params.p,
      input.newPasswordRecord.params.keyLen,
      input.newPasswordRecord.params.maxmem,
      now,
      existing.account_id,
      input.expectedVerifierVersion
    )
    if (result.changes === 0) {
      db.exec('ROLLBACK;')
      return { ok: false, error: 'version_mismatch' }
    }
    db.exec('COMMIT;')
    return {
      ok: true,
      account: {
        accountId: existing.account_id,
        email: existing.email,
        userId: existing.user_id,
        profileId: existing.profile_id,
        organizationId: existing.organization_id,
        role: (existing.role ?? 'admin') as 'admin' | 'user',
        status: 'active',
        verifierVersion: newVerifierVersion,
        authEpoch: newAuthEpoch,
        createdAt: Number(existing.created_at),
        updatedAt: now
      }
    }
  } catch (err) {
    db.exec('ROLLBACK;')
    throw err
  }
}

export function executeReplacePasswordVerifierSqlite(
  db: DatabaseSync,
  accountId: string,
  input: { expectedVerifierVersion: number; newPasswordRecord: PasswordRecord },
  now: number
):
  | { ok: true; account: SecurityStateAccountIdentity }
  | { ok: false; error: 'version_mismatch' | 'not_found' | 'not_active' } {
  return executeMutatePasswordVerifierSqlite(db, accountId, input, now, true)
}

export function executeUpgradePasswordVerifierSqlite(
  db: DatabaseSync,
  accountId: string,
  input: { expectedVerifierVersion: number; newPasswordRecord: PasswordRecord },
  now: number
):
  | { ok: true; account: SecurityStateAccountIdentity }
  | { ok: false; error: 'version_mismatch' | 'not_found' | 'not_active' } {
  return executeMutatePasswordVerifierSqlite(db, accountId, input, now, false)
}
