import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { openOwnMobileRelaySecurityStateSqlite } from './own-mobile-relay-security-state-sqlite'

describe('SQLite Schema v5 Migration and Multi-Account Schema', () => {
  let tempDirs: string[] = []

  async function createTempDbPath(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'orca-sec-v5-test-'))
    tempDirs.push(dir)
    return join(dir, 'security-state.db')
  }

  afterEach(async () => {
    for (const dir of tempDirs) {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
    tempDirs = []
  })

  it('fresh empty DB (v0) initializes at user_version 5 without singleton_id', async () => {
    const dbPath = await createTempDbPath()
    const state = openOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: true })
    await state.close()

    const checkDb = new DatabaseSync(dbPath)
    const ver = checkDb.prepare('PRAGMA user_version;').get() as { user_version: number }
    expect(ver.user_version).toBe(5)

    const cols = checkDb.prepare('PRAGMA table_info(operator_account);').all() as { name: string }[]
    const colNames = cols.map((c) => c.name)
    expect(colNames).not.toContain('singleton_id')
    expect(colNames).toContain('role')
    expect(colNames).toContain('status')
    checkDb.close()
  })

  it('migrates v4 database with children to v5 preserving child foreign keys and rows', async () => {
    const dbPath = await createTempDbPath()
    const rawDb = new DatabaseSync(dbPath)
    rawDb.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;')
    rawDb.exec(`
      CREATE TABLE operator_account (
        singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
        account_id TEXT NOT NULL UNIQUE, email TEXT NOT NULL,
        user_id TEXT NOT NULL, profile_id TEXT NOT NULL, organization_id TEXT NOT NULL,
        verifier_version INTEGER NOT NULL, auth_epoch INTEGER NOT NULL,
        password_version INTEGER NOT NULL, password_verifier TEXT NOT NULL, password_salt TEXT NOT NULL,
        param_n INTEGER NOT NULL, param_r INTEGER NOT NULL, param_p INTEGER NOT NULL,
        param_key_len INTEGER NOT NULL, param_maxmem INTEGER NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE access_sessions (
        session_id TEXT PRIMARY KEY, account_id TEXT NOT NULL,
        access_token_hash TEXT NOT NULL UNIQUE, auth_epoch INTEGER NOT NULL,
        expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, revoked_at INTEGER,
        user_id TEXT NOT NULL, profile_id TEXT NOT NULL, organization_id TEXT NOT NULL,
        email TEXT NOT NULL, cloud_profile_id TEXT NOT NULL,
        FOREIGN KEY (account_id) REFERENCES operator_account(account_id) ON DELETE CASCADE
      );
      CREATE TABLE relay_grants (
        grant_id TEXT PRIMARY KEY, account_id TEXT NOT NULL, parent_session_id TEXT NOT NULL,
        relay_token_hash TEXT NOT NULL UNIQUE, relay_host_id TEXT NOT NULL,
        host_public_key_b64 TEXT NOT NULL, auth_epoch INTEGER NOT NULL,
        expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, revoked_at INTEGER,
        user_id TEXT NOT NULL, profile_id TEXT NOT NULL, organization_id TEXT NOT NULL,
        FOREIGN KEY (account_id) REFERENCES operator_account(account_id) ON DELETE CASCADE,
        FOREIGN KEY (parent_session_id) REFERENCES access_sessions(session_id) ON DELETE CASCADE
      );
      CREATE TABLE device_credentials (
        relay_host_id TEXT NOT NULL, relay_device_id TEXT NOT NULL,
        last_install_req_id TEXT NOT NULL, current_resume_token_hash TEXT NOT NULL,
        current_version INTEGER NOT NULL, resume_expires_at INTEGER NOT NULL,
        authorization_mode TEXT NOT NULL, grace_resume_token_hash TEXT,
        grace_expires_at INTEGER, revoked_at INTEGER, key_expiry_disabled INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (relay_host_id, relay_device_id)
      );
      CREATE TABLE operator_sessions (
        session_id TEXT PRIMARY KEY, account_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
        auth_epoch INTEGER NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, revoked_at INTEGER,
        FOREIGN KEY (account_id) REFERENCES operator_account(account_id) ON DELETE CASCADE
      );
      CREATE TABLE refresh_tokens (
        token_hash TEXT PRIMARY KEY, session_id TEXT NOT NULL, account_id TEXT NOT NULL,
        auth_epoch INTEGER NOT NULL, expires_at INTEGER, created_at INTEGER NOT NULL, revoked_at INTEGER,
        FOREIGN KEY (account_id) REFERENCES operator_account(account_id) ON DELETE CASCADE,
        FOREIGN KEY (session_id) REFERENCES access_sessions(session_id) ON DELETE CASCADE
      );
      CREATE TABLE host_key_expiry (
        relay_host_id TEXT PRIMARY KEY, key_expiry_disabled INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL
      );
      CREATE TABLE audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, type TEXT NOT NULL, fields_json TEXT NOT NULL
      );
      PRAGMA user_version = 4;
    `)

    rawDb
      .prepare(`
      INSERT INTO operator_account (
        singleton_id, account_id, email, user_id, profile_id, organization_id,
        verifier_version, auth_epoch, password_version, password_verifier, password_salt,
        param_n, param_r, param_p, param_key_len, param_maxmem, created_at, updated_at
      ) VALUES (
        1, 'acc_v4', 'Admin@Example.COM', 'usr_v4', 'prof_v4', 'org_v4',
        1, 1, 1, 'ver_hash', 'salt_1', 16384, 8, 1, 32, 33554432, 1000, 1000
      )
    `)
      .run()

    rawDb
      .prepare(`
      INSERT INTO access_sessions (
        session_id, account_id, access_token_hash, auth_epoch, expires_at,
        created_at, revoked_at, user_id, profile_id, organization_id, email, cloud_profile_id
      ) VALUES (
        'sess_v4', 'acc_v4', 'token_hash_v4', 1, 5000, 1000, NULL, 'usr_v4', 'prof_v4', 'org_v4', 'Admin@Example.COM', 'cloud_v4'
      )
    `)
      .run()

    rawDb
      .prepare(`
      INSERT INTO relay_grants (
        grant_id, account_id, parent_session_id, relay_token_hash, relay_host_id,
        host_public_key_b64, auth_epoch, expires_at, created_at, revoked_at,
        user_id, profile_id, organization_id
      ) VALUES (
        'grant_v4', 'acc_v4', 'sess_v4', 'relay_hash_v4', 'host_v4', 'pubkey_v4', 1, 5000, 1000, NULL, 'usr_v4', 'prof_v4', 'org_v4'
      )
    `)
      .run()

    rawDb
      .prepare(`
      INSERT INTO operator_sessions (
        session_id, account_id, token_hash, auth_epoch, expires_at, created_at, revoked_at
      ) VALUES (
        'opsess_v4', 'acc_v4', 'op_token_hash_v4', 1, 5000, 1000, NULL
      )
    `)
      .run()

    rawDb
      .prepare(`
      INSERT INTO refresh_tokens (
        token_hash, session_id, account_id, auth_epoch, expires_at, created_at, revoked_at
      ) VALUES (
        'refresh_hash_v4', 'sess_v4', 'acc_v4', 1, 5000, 1000, NULL
      )
    `)
      .run()
    rawDb.close()

    const state = openOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: true })
    await state.close()

    const checkDb = new DatabaseSync(dbPath)
    const ver = checkDb.prepare('PRAGMA user_version;').get() as { user_version: number }
    expect(ver.user_version).toBe(5)

    const fkCheck = checkDb.prepare('PRAGMA foreign_key_check;').all()
    expect(fkCheck).toEqual([])

    const acc = checkDb
      .prepare('SELECT * FROM operator_account WHERE account_id = ?;')
      .get('acc_v4') as Record<string, unknown>
    expect(acc).toBeDefined()
    expect(acc.singleton_id).toBeUndefined()
    expect(acc.role).toBe('admin')
    expect(acc.status).toBe('active')
    expect(acc.email).toBe('admin@example.com')
    expect(acc.password_verifier).toBe('ver_hash')

    const sess = checkDb
      .prepare('SELECT * FROM access_sessions WHERE session_id = ?;')
      .get('sess_v4') as Record<string, unknown>
    expect(sess?.account_id).toBe('acc_v4')

    const grant = checkDb
      .prepare('SELECT * FROM relay_grants WHERE grant_id = ?;')
      .get('grant_v4') as Record<string, unknown>
    expect(grant?.account_id).toBe('acc_v4')

    const opSess = checkDb
      .prepare('SELECT * FROM operator_sessions WHERE session_id = ?;')
      .get('opsess_v4') as Record<string, unknown>
    expect(opSess?.account_id).toBe('acc_v4')

    const refresh = checkDb
      .prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?;')
      .get('refresh_hash_v4') as Record<string, unknown>
    expect(refresh?.account_id).toBe('acc_v4')

    checkDb.close()
  })

  it('enforces v5 CHECK constraints and uniqueness on operator_account', async () => {
    const dbPath = await createTempDbPath()
    const state = openOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: true })
    await state.close()

    const db = new DatabaseSync(dbPath)

    // 1. Insert active account - credential columns NOT NULL
    db.prepare(`
      INSERT INTO operator_account (
        account_id, email, user_id, profile_id, organization_id,
        role, status,
        verifier_version, auth_epoch, password_version, password_verifier,
        password_salt, param_n, param_r, param_p, param_key_len, param_maxmem,
        created_at, updated_at
      ) VALUES (
        'acc_active', 'user1@example.com', 'u1', 'p1', 'org1',
        'admin', 'active',
        1, 1, 1, 'ver', 'salt', 16384, 8, 1, 32, 33554432, 1000, 1000
      )
    `).run()

    // 2. Can insert second account (no singleton_id constraint)
    db.prepare(`
      INSERT INTO operator_account (
        account_id, email, user_id, profile_id, organization_id,
        role, status,
        verifier_version, auth_epoch, password_version, password_verifier,
        password_salt, param_n, param_r, param_p, param_key_len, param_maxmem,
        created_at, updated_at
      ) VALUES (
        'acc_active2', 'user2@example.com', 'u2', 'p2', 'org1',
        'user', 'active',
        1, 1, 1, 'ver', 'salt', 16384, 8, 1, 32, 33554432, 1000, 1000
      )
    `).run()

    // 3. Duplicate email (case-insensitive) rejected by UNIQUE index
    expect(() => {
      db.prepare(`
        INSERT INTO operator_account (
          account_id, email, user_id, profile_id, organization_id,
          role, status,
          verifier_version, auth_epoch, password_version, password_verifier,
          password_salt, param_n, param_r, param_p, param_key_len, param_maxmem,
          created_at, updated_at
        ) VALUES (
          'acc_dup', 'User1@Example.com', 'u3', 'p3', 'org1',
          'user', 'active',
          1, 1, 1, 'ver', 'salt', 16384, 8, 1, 32, 33554432, 1000, 1000
        )
      `).run()
    }).toThrow(/UNIQUE constraint failed/i)

    // 4. Duplicate user_id or profile_id rejected
    expect(() => {
      db.prepare(`
        INSERT INTO operator_account (
          account_id, email, user_id, profile_id, organization_id,
          role, status,
          verifier_version, auth_epoch, password_version, password_verifier,
          password_salt, param_n, param_r, param_p, param_key_len, param_maxmem,
          created_at, updated_at
        ) VALUES (
          'acc_dup_u', 'user3@example.com', 'u1', 'p3', 'org1',
          'user', 'active',
          1, 1, 1, 'ver', 'salt', 16384, 8, 1, 32, 33554432, 1000, 1000
        )
      `).run()
    }).toThrow(/UNIQUE constraint failed/i)

    // 5. Invited account must have NULL credential columns
    db.prepare(`
      INSERT INTO operator_account (
        account_id, email, user_id, profile_id, organization_id,
        role, status,
        verifier_version, auth_epoch, password_version, password_verifier,
        password_salt, param_n, param_r, param_p, param_key_len, param_maxmem,
        created_at, updated_at
      ) VALUES (
        'acc_invited', 'invited@example.com', 'u_inv', 'p_inv', 'org1',
        'user', 'invited',
        1, 1, NULL, NULL,
        NULL, NULL, NULL, NULL, NULL, NULL, 1000, 1000
      )
    `).run()

    // 6. Invited account with non-null password_verifier violates CHECK
    expect(() => {
      db.prepare(`
        INSERT INTO operator_account (
          account_id, email, user_id, profile_id, organization_id,
          role, status,
          verifier_version, auth_epoch, password_version, password_verifier,
          password_salt, param_n, param_r, param_p, param_key_len, param_maxmem,
          created_at, updated_at
        ) VALUES (
          'acc_inv_bad', 'inv_bad@example.com', 'u_inv_bad', 'p_inv_bad', 'org1',
          'user', 'invited',
          1, 1, 1, 'bad_ver',
          NULL, NULL, NULL, NULL, NULL, NULL, 1000, 1000
        )
      `).run()
    }).toThrow(/CHECK constraint failed/i)

    // 7. Active account with null password_verifier violates CHECK
    expect(() => {
      db.prepare(`
        INSERT INTO operator_account (
          account_id, email, user_id, profile_id, organization_id,
          role, status,
          verifier_version, auth_epoch, password_version, password_verifier,
          password_salt, param_n, param_r, param_p, param_key_len, param_maxmem,
          created_at, updated_at
        ) VALUES (
          'acc_act_bad', 'act_bad@example.com', 'u_act_bad', 'p_act_bad', 'org1',
          'user', 'active',
          1, 1, NULL, NULL,
          NULL, NULL, NULL, NULL, NULL, NULL, 1000, 1000
        )
      `).run()
    }).toThrow(/CHECK constraint failed/i)

    // 8. Disabled account with null password_verifier violates CHECK
    expect(() => {
      db.prepare(`
        INSERT INTO operator_account (
          account_id, email, user_id, profile_id, organization_id,
          role, status,
          verifier_version, auth_epoch, password_version, password_verifier,
          password_salt, param_n, param_r, param_p, param_key_len, param_maxmem,
          created_at, updated_at
        ) VALUES (
          'acc_dis_bad', 'dis_bad@example.com', 'u_dis_bad', 'p_dis_bad', 'org1',
          'user', 'disabled',
          1, 1, NULL, NULL,
          NULL, NULL, NULL, NULL, NULL, NULL, 1000, 1000
        )
      `).run()
    }).toThrow(/CHECK constraint failed/i)

    // 9. Invalid role or status values violate CHECK
    expect(() => {
      db.prepare(`
        INSERT INTO operator_account (
          account_id, email, user_id, profile_id, organization_id,
          role, status,
          verifier_version, auth_epoch, password_version, password_verifier,
          password_salt, param_n, param_r, param_p, param_key_len, param_maxmem,
          created_at, updated_at
        ) VALUES (
          'acc_invalid_role', 'bad_role@example.com', 'u_br', 'p_br', 'org1',
          'superadmin', 'active',
          1, 1, 1, 'ver', 'salt', 16384, 8, 1, 32, 33554432, 1000, 1000
        )
      `).run()
    }).toThrow(/CHECK constraint failed/i)

    db.close()
  })

  it('failed copy leaves database at v4 with singleton_id table unchanged', async () => {
    const dbPath = await createTempDbPath()
    const rawDb = new DatabaseSync(dbPath)

    rawDb.exec(`
      CREATE TABLE operator_account (
        singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
        account_id TEXT NOT NULL UNIQUE, email TEXT NOT NULL,
        user_id TEXT NOT NULL, profile_id TEXT NOT NULL, organization_id TEXT NOT NULL,
        verifier_version INTEGER NOT NULL, auth_epoch INTEGER NOT NULL,
        password_version INTEGER NOT NULL, password_verifier TEXT NOT NULL, password_salt TEXT NOT NULL,
        param_n INTEGER NOT NULL, param_r INTEGER NOT NULL, param_p INTEGER NOT NULL,
        param_key_len INTEGER NOT NULL, param_maxmem INTEGER NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, type TEXT NOT NULL, fields_json TEXT NOT NULL
      );
      PRAGMA user_version = 4;
    `)

    rawDb
      .prepare(`
      INSERT INTO operator_account (
        singleton_id, account_id, email, user_id, profile_id, organization_id,
        verifier_version, auth_epoch, password_version, password_verifier, password_salt,
        param_n, param_r, param_p, param_key_len, param_maxmem, created_at, updated_at
      ) VALUES (
        1, 'acc_v4_stay', 'admin@example.com', 'usr_v4', 'prof_v4', 'org_v4',
        1, 1, 1, 'ver', 'salt', 16384, 8, 1, 32, 33554432, 1000, 1000
      )
    `)
      .run()

    rawDb.exec(`CREATE TABLE operator_account_old (conflict_col TEXT PRIMARY KEY);`)
    rawDb.close()

    await expect(async () => {
      openOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: true })
    }).rejects.toThrow()

    const checkDb = new DatabaseSync(dbPath)
    const ver = checkDb.prepare('PRAGMA user_version;').get() as { user_version: number }
    expect(ver.user_version).toBe(4)

    const cols = checkDb.prepare('PRAGMA table_info(operator_account);').all() as { name: string }[]
    const colNames = cols.map((c) => c.name)
    expect(colNames).toContain('singleton_id')
    checkDb.close()
  })
})
