import { randomBytes } from 'node:crypto'
import type { PasswordRecord } from './own-mobile-relay-password'
import type {
  SecurityStateAccountBootstrapInput,
  SecurityStateAccountIdentity
} from './own-mobile-relay-security-state'

export type SqliteAccountRow = {
  singleton_id: number
  account_id: string
  email: string
  user_id: string
  profile_id: string
  organization_id: string
  verifier_version: number
  auth_epoch: number
  password_version: number
  password_verifier: string
  password_salt: string
  param_n: number
  param_r: number
  param_p: number
  param_key_len: number
  param_maxmem: number
  created_at: number
  updated_at: number
}

function mapAccountRow(row: SqliteAccountRow): SecurityStateAccountIdentity {
  return {
    accountId: row.account_id,
    email: row.email,
    userId: row.user_id,
    profileId: row.profile_id,
    organizationId: row.organization_id,
    verifierVersion: Number(row.verifier_version),
    authEpoch: Number(row.auth_epoch),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function executeGetAccountSqlite(db: any): SecurityStateAccountIdentity | null {
  const row = db
    .prepare(
      `SELECT singleton_id, account_id, email, user_id, profile_id, organization_id,
              verifier_version, auth_epoch, created_at, updated_at
       FROM operator_account WHERE singleton_id = 1`
    )
    .get() as SqliteAccountRow | undefined
  return row ? mapAccountRow(row) : null
}

export function executeBootstrapAccountSqlite(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  input: SecurityStateAccountBootstrapInput,
  now: number
): SecurityStateAccountIdentity {
  db.exec('BEGIN IMMEDIATE;')
  try {
    const existing = db
      .prepare('SELECT account_id FROM operator_account WHERE singleton_id = 1')
      .get()
    if (existing) {
      throw new Error('account_already_initialized')
    }
    const accountId = randomBytes(16).toString('base64url')
    const stmt = db.prepare(`
      INSERT INTO operator_account (
        singleton_id, account_id, email, user_id, profile_id, organization_id,
        verifier_version, auth_epoch, password_version, password_verifier,
        password_salt, param_n, param_r, param_p, param_key_len, param_maxmem,
        created_at, updated_at
      ) VALUES (
        1, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `)
    stmt.run(
      accountId,
      input.email,
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
      email: input.email,
      userId: input.userId,
      profileId: input.profileId,
      organizationId: input.organizationId,
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function executeGetAccountPasswordRecordSqlite(db: any): {
  accountId: string
  verifierVersion: number
  authEpoch: number
  passwordRecord: PasswordRecord
} | null {
  const row = db
    .prepare(
      `SELECT singleton_id, account_id, verifier_version, auth_epoch,
              password_version, password_verifier, password_salt,
              param_n, param_r, param_p, param_key_len, param_maxmem
       FROM operator_account WHERE singleton_id = 1`
    )
    .get() as SqliteAccountRow | undefined
  if (!row) {
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

export function executeReplacePasswordVerifierSqlite(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  input: { expectedVerifierVersion: number; newPasswordRecord: PasswordRecord },
  now: number
):
  | { ok: true; account: SecurityStateAccountIdentity }
  | { ok: false; error: 'version_mismatch' | 'not_found' } {
  db.exec('BEGIN IMMEDIATE;')
  try {
    const existing = db
      .prepare(
        `SELECT singleton_id, account_id, email, user_id, profile_id, organization_id,
                verifier_version, auth_epoch, created_at, updated_at
         FROM operator_account WHERE singleton_id = 1`
      )
      .get() as SqliteAccountRow | undefined
    if (!existing) {
      db.exec('ROLLBACK;')
      return { ok: false, error: 'not_found' }
    }
    if (Number(existing.verifier_version) !== input.expectedVerifierVersion) {
      db.exec('ROLLBACK;')
      return { ok: false, error: 'version_mismatch' }
    }
    const newVerifierVersion = Number(existing.verifier_version) + 1
    const newAuthEpoch = Number(existing.auth_epoch) + 1

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
      WHERE singleton_id = 1 AND verifier_version = ?
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

export function executeUpgradePasswordVerifierSqlite(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  input: { expectedVerifierVersion: number; newPasswordRecord: PasswordRecord },
  now: number
):
  | { ok: true; account: SecurityStateAccountIdentity }
  | { ok: false; error: 'version_mismatch' | 'not_found' } {
  db.exec('BEGIN IMMEDIATE;')
  try {
    const existing = db
      .prepare(
        `SELECT singleton_id, account_id, email, user_id, profile_id, organization_id,
                verifier_version, auth_epoch, created_at, updated_at
         FROM operator_account WHERE singleton_id = 1`
      )
      .get() as SqliteAccountRow | undefined
    if (!existing) {
      db.exec('ROLLBACK;')
      return { ok: false, error: 'not_found' }
    }
    if (Number(existing.verifier_version) !== input.expectedVerifierVersion) {
      db.exec('ROLLBACK;')
      return { ok: false, error: 'version_mismatch' }
    }
    const newVerifierVersion = Number(existing.verifier_version) + 1
    const authEpoch = Number(existing.auth_epoch)

    const updateStmt = db.prepare(`
      UPDATE operator_account
      SET verifier_version = ?,
          password_version = ?,
          password_verifier = ?,
          password_salt = ?,
          param_n = ?,
          param_r = ?,
          param_p = ?,
          param_key_len = ?,
          param_maxmem = ?,
          updated_at = ?
      WHERE singleton_id = 1 AND verifier_version = ?
    `)
    const result = updateStmt.run(
      newVerifierVersion,
      input.newPasswordRecord.version,
      input.newPasswordRecord.verifier,
      input.newPasswordRecord.salt,
      input.newPasswordRecord.params.N,
      input.newPasswordRecord.params.r,
      input.newPasswordRecord.params.p,
      input.newPasswordRecord.params.keyLen,
      input.newPasswordRecord.params.maxmem,
      now,
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
        verifierVersion: newVerifierVersion,
        authEpoch,
        createdAt: Number(existing.created_at),
        updatedAt: now
      }
    }
  } catch (err) {
    db.exec('ROLLBACK;')
    throw err
  }
}
