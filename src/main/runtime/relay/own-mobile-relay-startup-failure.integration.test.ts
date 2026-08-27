import { describe, expect, it, afterEach, vi } from 'vitest'
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  chmodSync,
  statSync,
  openSync,
  closeSync,
  existsSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createServer } from 'node:net'
import { startOwnRelayServer, parseOwnRelayServeConfig } from './own-mobile-relay-main'
import { TEST_FAST_PASSWORD_POLICY, derivePasswordRecord } from './own-mobile-relay-password'
import { openOwnMobileRelaySecurityStateSqlite } from './own-mobile-relay-security-state-sqlite'

async function checkPortIsOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer()
    probe.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve(true)
      } else {
        resolve(false)
      }
    })
    probe.listen(port, '127.0.0.1', () => {
      probe.close(() => resolve(false))
    })
  })
}

describe('own-mobile-relay-startup-failure.integration (Scenario 5)', () => {
  const tempDirs: string[] = []

  function createTempDbPath(): string {
    const dir = mkdtempSync(join(tmpdir(), 'relay-failure-'))
    tempDirs.push(dir)
    return join(dir, 'relay.db')
  }

  afterEach(() => {
    vi.restoreAllMocks()
    for (const dir of tempDirs) {
      try {
        chmodSync(dir, 0o700)
        rmSync(dir, { recursive: true, force: true })
      } catch {
        // ignore
      }
    }
    tempDirs.length = 0
  })

  it('Scenario 5a: Corrupt SQLite file prevents port binding and fails closed', async () => {
    const dbPath = createTempDbPath()
    writeFileSync(dbPath, 'NOT A SQLITE FILE HEADER CRASH')
    const targetPort = 49152 + Math.floor(Math.random() * 1000)

    const config = parseOwnRelayServeConfig({
      OWN_RELAY_STATE_PATH: dbPath,
      OWN_RELAY_ORIGIN: 'http://127.0.0.1',
      OWN_RELAY_AUTH_ORIGIN: 'http://127.0.0.1',
      OWN_RELAY_CLIENT_ID: 'orca-desktop',
      OWN_RELAY_LISTEN_PORT: String(targetPort),
      OWN_RELAY_LISTEN_HOST: '127.0.0.1',
      OWN_RELAY_OPERATOR_EMAIL: 'op@example.com',
      OWN_RELAY_OPERATOR_PASSWORD: 'secure-password-123',
      OWN_RELAY_OPERATOR_USER_ID: 'user-1',
      OWN_RELAY_OPERATOR_PROFILE_ID: 'prof-1'
    })

    await expect(
      startOwnRelayServer({
        config,
        passwordPolicy: TEST_FAST_PASSWORD_POLICY
      })
    ).rejects.toThrow()

    // Explicit negative assertion: Prove NO port bind occurred
    const bound = await checkPortIsOpen(targetPort)
    expect(bound).toBe(false)
  })

  it('Scenario 5b: Unsupported future schema version prevents port binding', async () => {
    const dbPath = createTempDbPath()
    const fd = openSync(dbPath, 'w', 0o600)
    closeSync(fd)
    chmodSync(dbPath, 0o600)
    const db = new DatabaseSync(dbPath)
    db.exec(`PRAGMA user_version = 999;`)
    db.close()
    chmodSync(dbPath, 0o600)
    const targetPort = 49152 + Math.floor(Math.random() * 1000)

    const config = parseOwnRelayServeConfig({
      OWN_RELAY_STATE_PATH: dbPath,
      OWN_RELAY_ORIGIN: 'http://127.0.0.1',
      OWN_RELAY_AUTH_ORIGIN: 'http://127.0.0.1',
      OWN_RELAY_CLIENT_ID: 'orca-desktop',
      OWN_RELAY_LISTEN_PORT: String(targetPort),
      OWN_RELAY_LISTEN_HOST: '127.0.0.1',
      OWN_RELAY_OPERATOR_EMAIL: 'op@example.com',
      OWN_RELAY_OPERATOR_PASSWORD: 'secure-password-123',
      OWN_RELAY_OPERATOR_USER_ID: 'user-1',
      OWN_RELAY_OPERATOR_PROFILE_ID: 'prof-1'
    })

    await expect(
      startOwnRelayServer({
        config,
        passwordPolicy: TEST_FAST_PASSWORD_POLICY
      })
    ).rejects.toThrow(/unsupported_schema_version/)

    const bound = await checkPortIsOpen(targetPort)
    expect(bound).toBe(false)
  })

  it('Scenario 5c: Failed migration prevents port binding', async () => {
    const dbPath = createTempDbPath()
    const db = new DatabaseSync(dbPath)
    // Create conflicting operator_account table that breaks migration 1
    db.exec(`
      CREATE TABLE operator_account (
        broken_column INTEGER
      );
    `)
    db.close()
    const targetPort = 49152 + Math.floor(Math.random() * 1000)

    const config = parseOwnRelayServeConfig({
      OWN_RELAY_STATE_PATH: dbPath,
      OWN_RELAY_ORIGIN: 'http://127.0.0.1',
      OWN_RELAY_AUTH_ORIGIN: 'http://127.0.0.1',
      OWN_RELAY_CLIENT_ID: 'orca-desktop',
      OWN_RELAY_LISTEN_PORT: String(targetPort),
      OWN_RELAY_LISTEN_HOST: '127.0.0.1',
      OWN_RELAY_OPERATOR_EMAIL: 'op@example.com',
      OWN_RELAY_OPERATOR_PASSWORD: 'secure-password-123',
      OWN_RELAY_OPERATOR_USER_ID: 'user-1',
      OWN_RELAY_OPERATOR_PROFILE_ID: 'prof-1'
    })

    await expect(
      startOwnRelayServer({
        config,
        passwordPolicy: TEST_FAST_PASSWORD_POLICY
      })
    ).rejects.toThrow()

    const bound = await checkPortIsOpen(targetPort)
    expect(bound).toBe(false)
  })

  it('Scenario 5d: Insecure permissions on DB or dir prevent port binding (POSIX)', async () => {
    if (process.platform === 'win32') {
      return
    }
    const dbPath = createTempDbPath()
    const dir = join(dbPath, '..')
    chmodSync(dir, 0o777)
    const targetPort = 49152 + Math.floor(Math.random() * 1000)

    const config = parseOwnRelayServeConfig({
      OWN_RELAY_STATE_PATH: dbPath,
      OWN_RELAY_ORIGIN: 'http://127.0.0.1',
      OWN_RELAY_AUTH_ORIGIN: 'http://127.0.0.1',
      OWN_RELAY_CLIENT_ID: 'orca-desktop',
      OWN_RELAY_LISTEN_PORT: String(targetPort),
      OWN_RELAY_LISTEN_HOST: '127.0.0.1',
      OWN_RELAY_OPERATOR_EMAIL: 'op@example.com',
      OWN_RELAY_OPERATOR_PASSWORD: 'secure-password-123',
      OWN_RELAY_OPERATOR_USER_ID: 'user-1',
      OWN_RELAY_OPERATOR_PROFILE_ID: 'prof-1'
    })

    await expect(
      startOwnRelayServer({
        config,
        passwordPolicy: TEST_FAST_PASSWORD_POLICY
      })
    ).rejects.toThrow(/insecure_parent_directory/)

    const bound = await checkPortIsOpen(targetPort)
    expect(bound).toBe(false)
  })

  it('Scenario 5d-2: Insecure existing DB file permissions (0644) prevent port binding and fail closed without file mutation', async () => {
    if (process.platform === 'win32') {
      return
    }
    const dbPath = createTempDbPath()
    writeFileSync(dbPath, 'test-db-content')
    chmodSync(dbPath, 0o644)
    const targetPort = 49152 + Math.floor(Math.random() * 1000)

    const config = parseOwnRelayServeConfig({
      OWN_RELAY_STATE_PATH: dbPath,
      OWN_RELAY_ORIGIN: 'http://127.0.0.1',
      OWN_RELAY_AUTH_ORIGIN: 'http://127.0.0.1',
      OWN_RELAY_CLIENT_ID: 'orca-desktop',
      OWN_RELAY_LISTEN_PORT: String(targetPort),
      OWN_RELAY_LISTEN_HOST: '127.0.0.1',
      OWN_RELAY_OPERATOR_EMAIL: 'op@example.com',
      OWN_RELAY_OPERATOR_PASSWORD: 'secure-password-123',
      OWN_RELAY_OPERATOR_USER_ID: 'user-1',
      OWN_RELAY_OPERATOR_PROFILE_ID: 'prof-1'
    })

    await expect(
      startOwnRelayServer({
        config,
        passwordPolicy: TEST_FAST_PASSWORD_POLICY
      })
    ).rejects.toThrow(/insecure_database_permissions/)

    // File permissions must not be mutated
    const st = statSync(dbPath)
    expect(st.mode & 0o777).toBe(0o644)

    const bound = await checkPortIsOpen(targetPort)
    expect(bound).toBe(false)
  })

  it('Scenario 5d-3: Post-open sidecar permission failure closes DB handle, fails closed, and binds no port', async () => {
    if (process.platform === 'win32') {
      return
    }
    const dbPath = createTempDbPath()
    const walPath = `${dbPath}-wal`
    const targetPort = 49152 + Math.floor(Math.random() * 1000)

    const config = parseOwnRelayServeConfig({
      OWN_RELAY_STATE_PATH: dbPath,
      OWN_RELAY_ORIGIN: 'http://127.0.0.1',
      OWN_RELAY_AUTH_ORIGIN: 'http://127.0.0.1',
      OWN_RELAY_CLIENT_ID: 'orca-desktop',
      OWN_RELAY_LISTEN_PORT: String(targetPort),
      OWN_RELAY_LISTEN_HOST: '127.0.0.1',
      OWN_RELAY_OPERATOR_EMAIL: 'op@example.com',
      OWN_RELAY_OPERATOR_PASSWORD: 'secure-password-123',
      OWN_RELAY_OPERATOR_USER_ID: 'user-1',
      OWN_RELAY_OPERATOR_PROFILE_ID: 'prof-1'
    })

    const capturedDbInstances: DatabaseSync[] = []
    let sidecarChmodded = false

    // Spy on DatabaseSync.prototype.exec to capture handle and chmod WAL sidecar after migrations
    const origExec = DatabaseSync.prototype.exec
    const spy = vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(function (
      this: DatabaseSync,
      sql: string
    ) {
      const res = origExec.call(this, sql)
      if (!sidecarChmodded && sql.includes('PRAGMA user_version = 1;')) {
        sidecarChmodded = true
        capturedDbInstances.push(this)
        if (existsSync(walPath)) {
          chmodSync(walPath, 0o644)
        } else {
          const fd = openSync(walPath, 'w', 0o644)
          closeSync(fd)
          chmodSync(walPath, 0o644)
        }
      }
      return res
    })

    try {
      await expect(
        startOwnRelayServer({
          config,
          passwordPolicy: TEST_FAST_PASSWORD_POLICY
        })
      ).rejects.toThrow(/insecure_sidecar_permissions/)

      // 1. Port must not be bound
      const bound = await checkPortIsOpen(targetPort)
      expect(bound).toBe(false)

      // 2. DB handle must be released: invoking method on DatabaseSync throws "database is not open"
      expect(capturedDbInstances.length).toBeGreaterThan(0)
      const captured = capturedDbInstances[0]
      expect(() => {
        captured.exec('PRAGMA schema_version;')
      }).toThrow(/database is not open/)
    } finally {
      spy.mockRestore()
    }
  })

  it('Scenario 5e: Missing state path or auth origin fails synchronously in configuration validation before server startup', () => {
    // Finding 7: Validate pre-listen configuration parse errors reject before any server initialization
    expect(() =>
      parseOwnRelayServeConfig({
        OWN_RELAY_STATE_PATH: undefined,
        OWN_RELAY_ORIGIN: 'http://127.0.0.1',
        OWN_RELAY_AUTH_ORIGIN: 'http://127.0.0.1',
        OWN_RELAY_CLIENT_ID: 'orca-desktop'
      })
    ).toThrow(/Missing required environment variable: OWN_RELAY_STATE_PATH/)

    expect(() =>
      parseOwnRelayServeConfig({
        OWN_RELAY_STATE_PATH: createTempDbPath(),
        OWN_RELAY_ORIGIN: 'http://127.0.0.1',
        OWN_RELAY_AUTH_ORIGIN: undefined,
        OWN_RELAY_CLIENT_ID: 'orca-desktop'
      })
    ).toThrow(/Missing required environment variable: OWN_RELAY_AUTH_ORIGIN/)
  })

  it('Scenario 5f: Incomplete bootstrap variables prevent port binding', async () => {
    const dbPath = createTempDbPath()
    const targetPort = 49152 + Math.floor(Math.random() * 1000)
    const partialBootstrap = {
      OWN_RELAY_STATE_PATH: dbPath,
      OWN_RELAY_ORIGIN: 'http://127.0.0.1',
      OWN_RELAY_AUTH_ORIGIN: 'http://127.0.0.1',
      OWN_RELAY_CLIENT_ID: 'orca-desktop',
      OWN_RELAY_LISTEN_PORT: String(targetPort),
      OWN_RELAY_LISTEN_HOST: '127.0.0.1',
      OWN_RELAY_OPERATOR_EMAIL: 'op@example.com',
      OWN_RELAY_OPERATOR_PASSWORD: 'secure-password-123'
      // Missing userId and profileId
    }

    const config = parseOwnRelayServeConfig(partialBootstrap)
    await expect(
      startOwnRelayServer({
        config,
        passwordPolicy: TEST_FAST_PASSWORD_POLICY
      })
    ).rejects.toThrow(/Incomplete bootstrap operator credentials/)

    const bound = await checkPortIsOpen(targetPort)
    expect(bound).toBe(false)
  })

  it('Scenario 5g: Consumed bootstrap on initialized DB prevents port binding', async () => {
    const dbPath = createTempDbPath()
    const targetPort = 49152 + Math.floor(Math.random() * 1000)
    // Initialize DB with account
    const state = openOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: true })
    const rec = await derivePasswordRecord('initial-password-123', TEST_FAST_PASSWORD_POLICY)
    await state.bootstrapAccount({
      email: 'op@example.com',
      userId: 'user-1',
      profileId: 'prof-1',
      organizationId: '',
      passwordRecord: rec
    })
    await state.close()

    const config = parseOwnRelayServeConfig({
      OWN_RELAY_STATE_PATH: dbPath,
      OWN_RELAY_ORIGIN: 'http://127.0.0.1',
      OWN_RELAY_AUTH_ORIGIN: 'http://127.0.0.1',
      OWN_RELAY_CLIENT_ID: 'orca-desktop',
      OWN_RELAY_LISTEN_PORT: String(targetPort),
      OWN_RELAY_LISTEN_HOST: '127.0.0.1',
      OWN_RELAY_OPERATOR_EMAIL: 'op@example.com',
      OWN_RELAY_OPERATOR_PASSWORD: 'secure-password-123',
      OWN_RELAY_OPERATOR_USER_ID: 'user-1',
      OWN_RELAY_OPERATOR_PROFILE_ID: 'prof-1'
    })

    await expect(
      startOwnRelayServer({
        config,
        passwordPolicy: TEST_FAST_PASSWORD_POLICY
      })
    ).rejects.toThrow(/bootstrap_already_complete/)

    const bound = await checkPortIsOpen(targetPort)
    expect(bound).toBe(false)
  })
})
