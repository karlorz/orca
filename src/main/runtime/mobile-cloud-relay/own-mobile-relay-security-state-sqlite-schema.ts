import { statSync, existsSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'

export const CURRENT_SCHEMA_VERSION = 5
export const DEFAULT_BUSY_TIMEOUT_MS = 5000

/** SQLite INTEGER flag: missing/null defaults to disabled-expiry (1). */
export function sqliteKeyExpiryDisabled(value: number | null | undefined): boolean {
  return value === null || value === undefined || Number(value) === 1
}

export function verifySqliteParentDirectorySecurity(dirPath: string): void {
  const st = statSync(dirPath)
  if ((st.mode & 0o020) !== 0 || (st.mode & 0o002) !== 0) {
    throw new Error(
      `insecure_parent_directory: directory ${dirPath} has insecure permissions (${(st.mode & 0o777).toString(8)})`
    )
  }
}

export function verifySqlitePathSecurity(dbPath: string): void {
  if (existsSync(dbPath)) {
    const st = statSync(dbPath)
    if (!st.isFile()) {
      throw new Error(`not_a_regular_file: database path ${dbPath} is not a regular file`)
    }
    if ((st.mode & 0o077) !== 0) {
      throw new Error(
        `insecure_database_permissions: database ${dbPath} has group/world permissions (${(st.mode & 0o777).toString(8)})`
      )
    }
  }
  for (const sidecar of [`${dbPath}-wal`, `${dbPath}-shm`]) {
    if (existsSync(sidecar)) {
      const stSidecar = statSync(sidecar)
      if (!stSidecar.isFile()) {
        throw new Error(`not_a_regular_file: sidecar path ${sidecar} is not a regular file`)
      }
      if ((stSidecar.mode & 0o077) !== 0) {
        throw new Error(
          `insecure_sidecar_permissions: sidecar ${sidecar} has group/world permissions (${(stSidecar.mode & 0o777).toString(8)})`
        )
      }
    }
  }
}

export function applySqlitePragmas(db: DatabaseSync, busyTimeoutMs: number): void {
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA synchronous = FULL;')
  db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs};`)
}

export function verifySqliteQuickCheck(db: DatabaseSync): void {
  const result = db.prepare('PRAGMA quick_check(1);').get() as { quick_check?: string } | undefined
  if (!result || result.quick_check !== 'ok') {
    throw new Error(`database_corrupt: quick_check failed: ${JSON.stringify(result)}`)
  }
}

const V5_OPERATOR_ACCOUNT_DDL = `
  CREATE TABLE IF NOT EXISTS operator_account (
    account_id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    user_id TEXT NOT NULL UNIQUE,
    profile_id TEXT NOT NULL UNIQUE,
    organization_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
    status TEXT NOT NULL CHECK (status IN ('invited', 'active', 'disabled')),
    verifier_version INTEGER NOT NULL,
    auth_epoch INTEGER NOT NULL,
    password_version INTEGER,
    password_verifier TEXT,
    password_salt TEXT,
    param_n INTEGER,
    param_r INTEGER,
    param_p INTEGER,
    param_key_len INTEGER,
    param_maxmem INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    CHECK (
      (status = 'invited' AND password_version IS NULL AND password_verifier IS NULL AND password_salt IS NULL AND param_n IS NULL AND param_r IS NULL AND param_p IS NULL AND param_key_len IS NULL AND param_maxmem IS NULL)
      OR
      (status IN ('active', 'disabled') AND password_version IS NOT NULL AND password_verifier IS NOT NULL AND password_salt IS NOT NULL AND param_n IS NOT NULL AND param_r IS NOT NULL AND param_p IS NOT NULL AND param_key_len IS NOT NULL AND param_maxmem IS NOT NULL)
    )
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_operator_account_email_lower ON operator_account(lower(email));
`

export function runSqliteMigrations(db: DatabaseSync): void {
  const versionRow = db.prepare('PRAGMA user_version;').get() as
    | { user_version?: number }
    | undefined
  const currentVersion = Number(versionRow?.user_version ?? 0)
  if (currentVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `unsupported_schema_version: database version ${currentVersion} is higher than supported version ${CURRENT_SCHEMA_VERSION}`
    )
  }
  if (currentVersion === 0) {
    db.exec('BEGIN IMMEDIATE;')
    try {
      db.exec(`
        ${V5_OPERATOR_ACCOUNT_DDL}
        CREATE TABLE IF NOT EXISTS access_sessions (
          session_id TEXT PRIMARY KEY, account_id TEXT NOT NULL,
          access_token_hash TEXT NOT NULL UNIQUE, auth_epoch INTEGER NOT NULL,
          expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, revoked_at INTEGER,
          user_id TEXT NOT NULL, profile_id TEXT NOT NULL, organization_id TEXT NOT NULL,
          email TEXT NOT NULL, cloud_profile_id TEXT NOT NULL,
          FOREIGN KEY (account_id) REFERENCES operator_account(account_id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_access_sessions_token_hash ON access_sessions(access_token_hash);
        CREATE INDEX IF NOT EXISTS idx_access_sessions_expires ON access_sessions(expires_at);
        CREATE TABLE IF NOT EXISTS relay_grants (
          grant_id TEXT PRIMARY KEY, account_id TEXT NOT NULL, parent_session_id TEXT NOT NULL,
          relay_token_hash TEXT NOT NULL UNIQUE, relay_host_id TEXT NOT NULL,
          host_public_key_b64 TEXT NOT NULL, auth_epoch INTEGER NOT NULL,
          expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, revoked_at INTEGER,
          user_id TEXT NOT NULL, profile_id TEXT NOT NULL, organization_id TEXT NOT NULL,
          FOREIGN KEY (account_id) REFERENCES operator_account(account_id) ON DELETE CASCADE,
          FOREIGN KEY (parent_session_id) REFERENCES access_sessions(session_id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_relay_grants_token_hash ON relay_grants(relay_token_hash);
        CREATE INDEX IF NOT EXISTS idx_relay_grants_parent_session ON relay_grants(parent_session_id);
        CREATE INDEX IF NOT EXISTS idx_relay_grants_expires ON relay_grants(expires_at);
        CREATE TABLE IF NOT EXISTS device_credentials (
          relay_host_id TEXT NOT NULL, relay_device_id TEXT NOT NULL,
          last_install_req_id TEXT NOT NULL, current_resume_token_hash TEXT NOT NULL,
          current_version INTEGER NOT NULL, resume_expires_at INTEGER NOT NULL,
          authorization_mode TEXT NOT NULL, grace_resume_token_hash TEXT,
          grace_expires_at INTEGER, revoked_at INTEGER, key_expiry_disabled INTEGER NOT NULL DEFAULT 1,
          PRIMARY KEY (relay_host_id, relay_device_id)
        );
        CREATE INDEX IF NOT EXISTS idx_device_credentials_current_hash ON device_credentials(relay_host_id, current_resume_token_hash);
        CREATE INDEX IF NOT EXISTS idx_device_credentials_grace_hash ON device_credentials(relay_host_id, grace_resume_token_hash);
        CREATE INDEX IF NOT EXISTS idx_device_credentials_resume_expires ON device_credentials(resume_expires_at);
        CREATE TABLE IF NOT EXISTS operator_sessions (
          session_id TEXT PRIMARY KEY, account_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
          auth_epoch INTEGER NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, revoked_at INTEGER,
          FOREIGN KEY (account_id) REFERENCES operator_account(account_id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_operator_sessions_token_hash ON operator_sessions(token_hash);
        CREATE INDEX IF NOT EXISTS idx_operator_sessions_expires ON operator_sessions(expires_at);
        CREATE TABLE IF NOT EXISTS refresh_tokens (
          token_hash TEXT PRIMARY KEY, session_id TEXT NOT NULL, account_id TEXT NOT NULL,
          auth_epoch INTEGER NOT NULL, expires_at INTEGER, created_at INTEGER NOT NULL, revoked_at INTEGER,
          FOREIGN KEY (account_id) REFERENCES operator_account(account_id) ON DELETE CASCADE,
          FOREIGN KEY (session_id) REFERENCES access_sessions(session_id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_refresh_tokens_session ON refresh_tokens(session_id);
        CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens(expires_at);
        CREATE TABLE IF NOT EXISTS host_key_expiry (
          relay_host_id TEXT PRIMARY KEY, key_expiry_disabled INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS audit_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, type TEXT NOT NULL, fields_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_audit_events_at_id ON audit_events(at, id);
        CREATE INDEX IF NOT EXISTS idx_audit_events_type_at ON audit_events(type, at);
        PRAGMA user_version = 5;
      `)
      db.exec('COMMIT;')
    } catch (err) {
      db.exec('ROLLBACK;')
      throw err
    }
  }
  const v1Row = db.prepare('PRAGMA user_version;').get() as { user_version?: number } | undefined
  if (Number(v1Row?.user_version ?? 0) === 1) {
    db.exec('BEGIN IMMEDIATE;')
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS operator_sessions (
          session_id TEXT PRIMARY KEY, account_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
          auth_epoch INTEGER NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, revoked_at INTEGER,
          FOREIGN KEY (account_id) REFERENCES operator_account(account_id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_operator_sessions_token_hash ON operator_sessions(token_hash);
        CREATE INDEX IF NOT EXISTS idx_operator_sessions_expires ON operator_sessions(expires_at);
        PRAGMA user_version = 2;
      `)
      db.exec('COMMIT;')
    } catch (err) {
      db.exec('ROLLBACK;')
      throw err
    }
  }
  const v2Row = db.prepare('PRAGMA user_version;').get() as { user_version?: number } | undefined
  if (Number(v2Row?.user_version ?? 0) === 2) {
    db.exec('BEGIN IMMEDIATE;')
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS refresh_tokens (
          token_hash TEXT PRIMARY KEY, session_id TEXT NOT NULL, account_id TEXT NOT NULL,
          auth_epoch INTEGER NOT NULL, expires_at INTEGER, created_at INTEGER NOT NULL, revoked_at INTEGER,
          FOREIGN KEY (account_id) REFERENCES operator_account(account_id) ON DELETE CASCADE,
          FOREIGN KEY (session_id) REFERENCES access_sessions(session_id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_refresh_tokens_session ON refresh_tokens(session_id);
        CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens(expires_at);
        CREATE TABLE IF NOT EXISTS host_key_expiry (
          relay_host_id TEXT PRIMARY KEY, key_expiry_disabled INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL
        );
        ALTER TABLE device_credentials ADD COLUMN key_expiry_disabled INTEGER NOT NULL DEFAULT 1;
        PRAGMA user_version = 3;
      `)
      db.exec('COMMIT;')
    } catch (err) {
      db.exec('ROLLBACK;')
      throw err
    }
  }
  const v3Row = db.prepare('PRAGMA user_version;').get() as { user_version?: number } | undefined
  if (Number(v3Row?.user_version ?? 0) === 3) {
    db.exec('BEGIN IMMEDIATE;')
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS audit_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, type TEXT NOT NULL, fields_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_audit_events_at_id ON audit_events(at, id);
        CREATE INDEX IF NOT EXISTS idx_audit_events_type_at ON audit_events(type, at);
        PRAGMA user_version = 4;
      `)
      db.exec('COMMIT;')
    } catch (err) {
      db.exec('ROLLBACK;')
      throw err
    }
  }
  const v4Row = db.prepare('PRAGMA user_version;').get() as { user_version?: number } | undefined
  if (Number(v4Row?.user_version ?? 0) === 4) {
    db.exec('PRAGMA foreign_keys = OFF;')
    db.exec('BEGIN IMMEDIATE;')
    try {
      db.exec('PRAGMA legacy_alter_table = ON;')
      db.exec('ALTER TABLE operator_account RENAME TO operator_account_old;')
      db.exec('PRAGMA legacy_alter_table = OFF;')
      db.exec(`
        ${V5_OPERATOR_ACCOUNT_DDL}
        INSERT INTO operator_account (
          account_id, email, user_id, profile_id, organization_id, role, status,
          verifier_version, auth_epoch, password_version, password_verifier, password_salt,
          param_n, param_r, param_p, param_key_len, param_maxmem, created_at, updated_at
        )
        SELECT
          account_id, lower(email), user_id, profile_id, organization_id, 'admin', 'active',
          verifier_version, auth_epoch, password_version, password_verifier, password_salt,
          param_n, param_r, param_p, param_key_len, param_maxmem, created_at, updated_at
        FROM operator_account_old;
        DROP TABLE operator_account_old;
        PRAGMA user_version = 5;
      `)
      db.exec('COMMIT;')
    } catch (err) {
      db.exec('ROLLBACK;')
      throw err
    } finally {
      db.exec('PRAGMA foreign_keys = ON;')
    }
  }
}
