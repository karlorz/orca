import { statSync, existsSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'

export const CURRENT_SCHEMA_VERSION = 3
export const DEFAULT_BUSY_TIMEOUT_MS = 5000

/** SQLite INTEGER flag: missing/null defaults to disabled-expiry (1). */
export function sqliteKeyExpiryDisabled(value: number | null | undefined): boolean {
  return value === null || value === undefined || Number(value) === 1
}

export function verifySqliteParentDirectorySecurity(dirPath: string): void {
  const st = statSync(dirPath)
  // Fail if group-writable (0o020) or world-writable (0o002)
  const isGroupWritable = (st.mode & 0o020) !== 0
  const isWorldWritable = (st.mode & 0o002) !== 0
  if (isGroupWritable || isWorldWritable) {
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
    // Fail closed if group (0o070) or world (0o007) bits are set
    if ((st.mode & 0o077) !== 0) {
      throw new Error(
        `insecure_database_permissions: database ${dbPath} has group/world permissions (${(st.mode & 0o777).toString(8)})`
      )
    }
  }

  // Check WAL and SHM sidecars if present
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
        CREATE TABLE IF NOT EXISTS operator_account (
          singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
          account_id TEXT NOT NULL UNIQUE,
          email TEXT NOT NULL,
          user_id TEXT NOT NULL,
          profile_id TEXT NOT NULL,
          organization_id TEXT NOT NULL,
          verifier_version INTEGER NOT NULL,
          auth_epoch INTEGER NOT NULL,
          password_version INTEGER NOT NULL,
          password_verifier TEXT NOT NULL,
          password_salt TEXT NOT NULL,
          param_n INTEGER NOT NULL,
          param_r INTEGER NOT NULL,
          param_p INTEGER NOT NULL,
          param_key_len INTEGER NOT NULL,
          param_maxmem INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS access_sessions (
          session_id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL,
          access_token_hash TEXT NOT NULL UNIQUE,
          auth_epoch INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          revoked_at INTEGER,
          user_id TEXT NOT NULL,
          profile_id TEXT NOT NULL,
          organization_id TEXT NOT NULL,
          email TEXT NOT NULL,
          cloud_profile_id TEXT NOT NULL,
          FOREIGN KEY (account_id) REFERENCES operator_account(account_id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_access_sessions_token_hash
          ON access_sessions(access_token_hash);
        CREATE INDEX IF NOT EXISTS idx_access_sessions_expires
          ON access_sessions(expires_at);

        CREATE TABLE IF NOT EXISTS relay_grants (
          grant_id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL,
          parent_session_id TEXT NOT NULL,
          relay_token_hash TEXT NOT NULL UNIQUE,
          relay_host_id TEXT NOT NULL,
          host_public_key_b64 TEXT NOT NULL,
          auth_epoch INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          revoked_at INTEGER,
          user_id TEXT NOT NULL,
          profile_id TEXT NOT NULL,
          organization_id TEXT NOT NULL,
          FOREIGN KEY (account_id) REFERENCES operator_account(account_id) ON DELETE CASCADE,
          FOREIGN KEY (parent_session_id) REFERENCES access_sessions(session_id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_relay_grants_token_hash
          ON relay_grants(relay_token_hash);
        CREATE INDEX IF NOT EXISTS idx_relay_grants_parent_session
          ON relay_grants(parent_session_id);
        CREATE INDEX IF NOT EXISTS idx_relay_grants_expires
          ON relay_grants(expires_at);

        CREATE TABLE IF NOT EXISTS device_credentials (
          relay_host_id TEXT NOT NULL,
          relay_device_id TEXT NOT NULL,
          last_install_req_id TEXT NOT NULL,
          current_resume_token_hash TEXT NOT NULL,
          current_version INTEGER NOT NULL,
          resume_expires_at INTEGER NOT NULL,
          authorization_mode TEXT NOT NULL,
          grace_resume_token_hash TEXT,
          grace_expires_at INTEGER,
          revoked_at INTEGER,
          PRIMARY KEY (relay_host_id, relay_device_id)
        );

        CREATE INDEX IF NOT EXISTS idx_device_credentials_current_hash
          ON device_credentials(relay_host_id, current_resume_token_hash);
        CREATE INDEX IF NOT EXISTS idx_device_credentials_grace_hash
          ON device_credentials(relay_host_id, grace_resume_token_hash);
        CREATE INDEX IF NOT EXISTS idx_device_credentials_resume_expires
          ON device_credentials(resume_expires_at);

        PRAGMA user_version = 1;
      `)
      db.exec('COMMIT;')
    } catch (err) {
      db.exec('ROLLBACK;')
      throw err
    }
  }

  const v1Row = db.prepare('PRAGMA user_version;').get() as { user_version?: number } | undefined
  const v1Version = Number(v1Row?.user_version ?? 0)

  if (v1Version === 1) {
    db.exec('BEGIN IMMEDIATE;')
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS operator_sessions (
          session_id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL,
          token_hash TEXT NOT NULL UNIQUE,
          auth_epoch INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          revoked_at INTEGER,
          FOREIGN KEY (account_id) REFERENCES operator_account(account_id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_operator_sessions_token_hash
          ON operator_sessions(token_hash);
        CREATE INDEX IF NOT EXISTS idx_operator_sessions_expires
          ON operator_sessions(expires_at);

        PRAGMA user_version = 2;
      `)
      db.exec('COMMIT;')
    } catch (err) {
      db.exec('ROLLBACK;')
      throw err
    }
  }

  const v2Row = db.prepare('PRAGMA user_version;').get() as { user_version?: number } | undefined
  const v2Version = Number(v2Row?.user_version ?? 0)

  if (v2Version === 2) {
    db.exec('BEGIN IMMEDIATE;')
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS refresh_tokens (
          token_hash TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          account_id TEXT NOT NULL,
          auth_epoch INTEGER NOT NULL,
          expires_at INTEGER,
          created_at INTEGER NOT NULL,
          revoked_at INTEGER,
          FOREIGN KEY (account_id) REFERENCES operator_account(account_id) ON DELETE CASCADE,
          FOREIGN KEY (session_id) REFERENCES access_sessions(session_id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_refresh_tokens_session
          ON refresh_tokens(session_id);
        CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires
          ON refresh_tokens(expires_at);

        CREATE TABLE IF NOT EXISTS host_key_expiry (
          relay_host_id TEXT PRIMARY KEY,
          key_expiry_disabled INTEGER NOT NULL DEFAULT 1,
          updated_at INTEGER NOT NULL
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
}
