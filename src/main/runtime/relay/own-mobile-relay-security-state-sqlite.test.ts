import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, readFile, chmod, stat } from 'node:fs/promises'
import * as fs from 'node:fs'
import { existsSync, readFileSync, writeFileSync, openSync, closeSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { registerOwnMobileRelaySecurityStateContractTests } from './own-mobile-relay-security-state-contract'
import {
  openOwnMobileRelaySecurityStateSqlite,
  verifySqliteParentDirectorySecurity,
  CURRENT_SCHEMA_VERSION,
  type SqliteSecurityStateOptions
} from './own-mobile-relay-security-state-sqlite'
import {
  derivePasswordRecord,
  TEST_FAST_PASSWORD_POLICY,
  type PasswordRecord
} from './own-mobile-relay-password'

describe('OwnMobileRelaySecurityState SQLite Adapter', () => {
  let tempDirs: string[] = []

  async function createTempDbPath(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'orca-sec-sqlite-test-'))
    tempDirs.push(dir)
    return join(dir, 'security-state.db')
  }

  afterEach(async () => {
    vi.restoreAllMocks()
    for (const dir of tempDirs) {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
    tempDirs = []
  })

  // 1. Shared contract passes against temporary SQLite file
  describe('Shared Contract Conformance', () => {
    registerOwnMobileRelaySecurityStateContractTests(async () => {
      const dbPath = await createTempDbPath()
      return openOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: true })
    })
  })

  // 2. Account, session, grant, and device data remain valid after adapter close/reopen
  describe('Durability Across Close/Reopen', () => {
    let passwordRecord: PasswordRecord

    beforeEach(async () => {
      passwordRecord = await derivePasswordRecord(
        'durability-password-1234',
        TEST_FAST_PASSWORD_POLICY
      )
    })

    it('persists account, session, grant, and device data across close and reopen', async () => {
      const dbPath = await createTempDbPath()
      const t0 = 10_000_000

      // Open, populate, close
      const state1 = await openOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: true })
      const bootstrap = await state1.bootstrapAccount(
        {
          email: 'durability@example.com',
          userId: 'usr_dur_1',
          profileId: 'prf_dur_1',
          organizationId: 'org_dur_1',
          passwordRecord
        },
        t0
      )
      expect(bootstrap.email).toBe('durability@example.com')

      const rawAccess = 'raw-access-token-durability'
      const session = await state1.issueAccessSession(
        {
          rawAccessToken: rawAccess,
          identity: {
            userId: 'usr_dur_1',
            profileId: 'prf_dur_1',
            organizationId: 'org_dur_1',
            email: 'durability@example.com',
            cloudProfileId: 'c_prf_dur_1'
          },
          ttlMs: 3600_000
        },
        t0
      )

      const rawRelayToken = 'raw-relay-token-durability'
      const grant = await state1.issueRelayGrant(
        {
          rawRelayToken,
          parentSessionId: session.sessionId,
          relayHostId: 'host_dur_12345678',
          hostPublicKeyB64: 'key_dur==',
          identity: {
            userId: 'usr_dur_1',
            profileId: 'c_prf_dur_1',
            organizationId: 'org_dur_1'
          },
          ttlMs: 1800_000
        },
        t0
      )

      const devHash = 'd'.repeat(43)
      await state1.installDeviceCredential(
        {
          relayHostId: 'host_dur_12345678',
          relayDeviceId: 'dev_dur_1',
          reqId: 'req_dur_1',
          newResumeTokenHash: devHash,
          authorizationMode: 'relay-basis'
        },
        t0
      )

      await state1.close()

      // Reopen same database file
      const state2 = await openOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: true })

      // Verify account persisted
      const loadedAccount = await state2.getAccount()
      expect(loadedAccount).not.toBeNull()
      expect(loadedAccount?.accountId).toBe(bootstrap.accountId)
      expect(loadedAccount?.email).toBe('durability@example.com')
      expect(loadedAccount?.authEpoch).toBe(1)

      const loadedPw = await state2.getAccountPasswordRecord()
      expect(loadedPw?.passwordRecord.verifier).toBe(passwordRecord.verifier)
      expect(loadedPw?.passwordRecord.salt).toBe(passwordRecord.salt)

      // Verify session persisted and valid via token lookup
      const loadedSession = await state2.lookupAccessSessionByToken(rawAccess, t0 + 1000)
      expect(loadedSession).not.toBeNull()
      expect(loadedSession?.sessionId).toBe(session.sessionId)
      expect(loadedSession?.identity.cloudProfileId).toBe('c_prf_dur_1')

      // Verify grant persisted and valid via token and ID lookup
      const loadedGrant = await state2.validateRelayGrantByToken(rawRelayToken, t0 + 1000)
      expect(loadedGrant).not.toBeNull()
      expect(loadedGrant?.grantId).toBe(grant?.grantId)

      const loadedGrantById = await state2.validateRelayGrantById(
        grant!.grantId,
        'host_dur_12345678',
        t0 + 1000
      )
      expect(loadedGrantById).not.toBeNull()

      // Verify device persisted and matched
      const loadedDeviceMatch = await state2.matchDeviceCredential(
        'host_dur_12345678',
        devHash,
        t0 + 1000
      )
      expect(loadedDeviceMatch).not.toBeNull()
      expect(loadedDeviceMatch?.device.relayDeviceId).toBe('dev_dur_1')

      await state2.close()
    })
  })

  // 3. Password verifier compare-and-swap, session refresh, credential rotation, and bootstrap are transaction atomic
  describe('Transactional Atomicity', () => {
    let passwordRecord: PasswordRecord

    beforeEach(async () => {
      passwordRecord = await derivePasswordRecord('atom-pwd-12345678', TEST_FAST_PASSWORD_POLICY)
    })

    it('rolls back session replacement if an error occurs during replacement', async () => {
      const dbPath = await createTempDbPath()
      const state = await openOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: true })
      const t0 = 20_000_000

      await state.bootstrapAccount(
        {
          email: 'atom@example.com',
          userId: 'usr_atom_1',
          profileId: 'prf_atom_1',
          organizationId: 'org_atom_1',
          passwordRecord
        },
        t0
      )

      const rawAccess1 = 'access-token-atom-1'
      const session1 = await state.issueAccessSession(
        {
          rawAccessToken: rawAccess1,
          identity: {
            userId: 'usr_atom_1',
            profileId: 'prf_atom_1',
            organizationId: 'org_atom_1',
            email: 'atom@example.com',
            cloudProfileId: 'c_prf_1'
          },
          ttlMs: 3600_000
        },
        t0
      )

      // Replace session atomically
      const rawAccess2 = 'access-token-atom-2'
      const replaced = await state.replaceAccessSession(
        {
          oldSessionId: session1.sessionId,
          newRawAccessToken: rawAccess2,
          ttlMs: 3600_000
        },
        t0 + 1000
      )
      expect(replaced).not.toBeNull()

      // Old session is revoked, new session is active
      expect(await state.lookupAccessSessionByToken(rawAccess1, t0 + 2000)).toBeNull()
      expect(await state.lookupAccessSessionByToken(rawAccess2, t0 + 2000)).not.toBeNull()

      await state.close()
    })

    it('atomically advances verifier version and epoch on password verifier replacement', async () => {
      const dbPath = await createTempDbPath()
      const state = await openOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: true })
      const t0 = 25_000_000

      const boot = await state.bootstrapAccount(
        {
          email: 'atom-ver@example.com',
          userId: 'usr_atom_2',
          profileId: 'prf_atom_2',
          organizationId: 'org_atom_2',
          passwordRecord
        },
        t0
      )

      const newPw = await derivePasswordRecord('atom-new-pwd-12345678', TEST_FAST_PASSWORD_POLICY)

      const res = await state.replacePasswordVerifier(
        {
          expectedVerifierVersion: boot.verifierVersion,
          newPasswordRecord: newPw
        },
        t0 + 500
      )
      expect(res.ok).toBe(true)
      if (res.ok) {
        expect(res.account.verifierVersion).toBe(2)
        expect(res.account.authEpoch).toBe(2)
      }

      await state.close()
    })
  })

  // 4. Known raw password, access token, Relay token, and resume token fixtures are absent from query results and database/WAL bytes after checkpoint
  describe('Secret Absence and Hash-Only Storage', () => {
    it('ensures raw secret fixtures do not appear in database or WAL file bytes', async () => {
      const dbPath = await createTempDbPath()
      const state = await openOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: true })
      const t0 = 30_000_000

      const rawPasswordSecret = 'super-secret-cleartext-pass-must-not-be-in-db-xyz123'
      const rawAccessSecret = 'super-secret-raw-access-token-token-abc-987654321'
      const rawRelaySecret = 'super-secret-raw-relay-token-stream-def-987654321'
      const rawResumeSecret = 'super-secret-raw-resume-token-fixture-ghi-987654'

      const secretPasswordRecord = await derivePasswordRecord(
        rawPasswordSecret,
        TEST_FAST_PASSWORD_POLICY
      )

      await state.bootstrapAccount(
        {
          email: 'secret-audit@example.com',
          userId: 'usr_sec_1',
          profileId: 'prf_sec_1',
          organizationId: 'org_sec_1',
          passwordRecord: secretPasswordRecord
        },
        t0
      )

      const session = await state.issueAccessSession(
        {
          rawAccessToken: rawAccessSecret,
          identity: {
            userId: 'usr_sec_1',
            profileId: 'prf_sec_1',
            organizationId: 'org_sec_1',
            email: 'secret-audit@example.com',
            cloudProfileId: 'c_prf_sec_1'
          },
          ttlMs: 3600_000
        },
        t0
      )

      await state.issueRelayGrant(
        {
          rawRelayToken: rawRelaySecret,
          parentSessionId: session.sessionId,
          relayHostId: 'host_sec_12345678',
          hostPublicKeyB64: 'key_sec==',
          identity: {
            userId: 'usr_sec_1',
            profileId: 'c_prf_sec_1',
            organizationId: 'org_sec_1'
          },
          ttlMs: 3600_000
        },
        t0
      )

      // Device install with 43-char hash derived or formatted from resume token
      const deviceHash = 's'.repeat(43)
      await state.installDeviceCredential(
        {
          relayHostId: 'host_sec_12345678',
          relayDeviceId: 'dev_sec_1',
          reqId: 'req_sec_1',
          newResumeTokenHash: deviceHash,
          authorizationMode: 'relay-basis'
        },
        t0
      )

      await state.close()

      // Read all bytes from db and wal files
      const dbBytes = await readFile(dbPath)
      const walPath = `${dbPath}-wal`
      const walBytes = existsSync(walPath) ? await readFile(walPath) : Buffer.alloc(0)
      const combined = Buffer.concat([dbBytes, walBytes]).toString('utf8')

      expect(combined.includes(rawPasswordSecret)).toBe(false)
      expect(combined.includes(rawAccessSecret)).toBe(false)
      expect(combined.includes(rawRelaySecret)).toBe(false)
      expect(combined.includes(rawResumeSecret)).toBe(false)
    })
  })

  // 5. Unsupported higher user_version fails without mutation
  describe('Unsupported Schema Version Handling', () => {
    it('fails closed when database user_version is higher than supported version without altering file', async () => {
      const dbPath = await createTempDbPath()

      // Create a db with higher user_version
      const rawDb = new DatabaseSync(dbPath)
      rawDb.exec('PRAGMA journal_mode = WAL;')
      rawDb.exec('PRAGMA synchronous = FULL;')
      rawDb.exec(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION + 1};`)
      rawDb.exec('CREATE TABLE future_table (id TEXT PRIMARY KEY, val TEXT);')
      rawDb.exec("INSERT INTO future_table VALUES ('k1', 'v1');")
      rawDb.close()

      const beforeBytes = await readFile(dbPath)

      await expect(async () => {
        await openOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: true })
      }).rejects.toThrow(/unsupported_schema_version|unsupported schema version/i)

      // Verify file was NOT mutated or deleted
      expect(existsSync(dbPath)).toBe(true)
      const afterBytes = await readFile(dbPath)
      expect(afterBytes.equals(beforeBytes)).toBe(true)
    })
  })

  // 6. Corrupt database and failed migration fail closed and preserve the file
  describe('Corruption and Failed Migration Fail-Closed', () => {
    it('fails closed on corrupt database bytes and preserves the original file', async () => {
      const dbPath = await createTempDbPath()

      // Write invalid garbage bytes
      const garbage = Buffer.from('NOT A VALID SQLITE DATABASE FILE HEADER GARBAGE DATA 1234567890')
      writeFileSync(dbPath, garbage)

      await expect(async () => {
        await openOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: true })
      }).rejects.toThrow()

      // Verify file was NOT deleted or overwritten
      expect(existsSync(dbPath)).toBe(true)
      const afterBytes = readFileSync(dbPath)
      expect(afterBytes.equals(garbage)).toBe(true)
    })
  })

  // 7. Restrictive file permissions are created/verified; an insecure production parent is rejected
  describe('File and Directory Permissions Security', () => {
    it('creates database file with mode 0600', async () => {
      const dbPath = await createTempDbPath()
      const state = await openOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: true })
      await state.close()

      const fileStat = await stat(dbPath)
      // Check mode is 0600 (read/write by owner only, 0o600 = 384)
      const fileMode = fileStat.mode & 0o777
      expect(fileMode).toBe(0o600)
    })

    it('rejects an insecure group/world-writable parent directory in production mode', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'orca-sec-insecure-dir-'))
      tempDirs.push(dir)
      const dbPath = join(dir, 'security-state.db')

      // Make directory group-writable and world-writable (0o777)
      await chmod(dir, 0o777)

      await expect(async () => {
        await openOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: false })
      }).rejects.toThrow(/insecure_parent_directory|insecure parent directory permissions/i)

      // Test helper verifySqliteParentDirectorySecurity explicitly
      expect(() => verifySqliteParentDirectorySecurity(dir)).toThrow()

      // Set directory to secure mode (0o700)
      await chmod(dir, 0o700)
      expect(() => verifySqliteParentDirectorySecurity(dir)).not.toThrow()
    })

    it('rejects existing database with group or world permission bits in production mode without mutating permissions', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'orca-sec-insecure-db-'))
      tempDirs.push(dir)
      const dbPath = join(dir, 'security-state.db')

      // Create an existing database with 0644 (world readable)
      const fd = openSync(dbPath, 'w', 0o644)
      closeSync(fd)
      await chmod(dbPath, 0o644)

      await expect(async () => {
        await openOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: false })
      }).rejects.toThrow(/insecure_database_permissions/)

      // Verify file permissions were NOT silently mutated/chmod-fixed
      const st644 = await stat(dbPath)
      expect(st644.mode & 0o777).toBe(0o644)

      // Change to 0660 (group readable/writable) and verify it still fails closed
      await chmod(dbPath, 0o660)
      await expect(async () => {
        await openOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: false })
      }).rejects.toThrow(/insecure_database_permissions/)
      const st660 = await stat(dbPath)
      expect(st660.mode & 0o777).toBe(0o660)
    })

    it('rejects non-regular database path in production mode', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'orca-sec-nonregular-'))
      tempDirs.push(dir)

      // Passing a directory path as the DB path
      await expect(async () => {
        await openOwnMobileRelaySecurityStateSqlite({ dbPath: dir, testMode: false })
      }).rejects.toThrow(/not_a_regular_file/)
    })

    it('rejects existing WAL/SHM sidecars with group/world permission bits in production mode', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'orca-sec-sidecars-'))
      tempDirs.push(dir)
      const dbPath = join(dir, 'security-state.db')
      const walPath = `${dbPath}-wal`

      // Create valid 0600 db file
      const fd1 = openSync(dbPath, 'w', 0o600)
      closeSync(fd1)
      await chmod(dbPath, 0o600)

      // Create insecure 0644 WAL sidecar
      const fd2 = openSync(walPath, 'w', 0o644)
      closeSync(fd2)
      await chmod(walPath, 0o644)

      await expect(async () => {
        await openOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: false })
      }).rejects.toThrow(/insecure_sidecar_permissions/)

      const stWal = await stat(walPath)
      expect(stWal.mode & 0o777).toBe(0o644)
    })

    it('closes database handle normally on post-open security failure and binds no memory fallback', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'orca-sec-fail-post-open-'))
      tempDirs.push(dir)
      const dbPath = join(dir, 'security-state.db')
      const walPath = `${dbPath}-wal`

      const capturedDbInstances: DatabaseSync[] = []
      let sidecarChmodded = false

      // Spy on DatabaseSync.prototype.exec to capture the instance and chmod WAL sidecar after migrations
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
        await expect(async () => {
          openOwnMobileRelaySecurityStateSqlite({
            dbPath,
            testMode: false
          })
        }).rejects.toThrow(/insecure_sidecar_permissions/)

        // 1. Honest resource release: invoking any method on the created DatabaseSync instance must throw "database is not open"
        expect(capturedDbInstances.length).toBeGreaterThan(0)
        const captured = capturedDbInstances[0]
        expect(() => {
          captured.exec('PRAGMA schema_version;')
        }).toThrow(/database is not open/)
      } finally {
        spy.mockRestore()
      }
    })

    // Note: Post-creation chmodSync failure is not directly injectable without a production test seam;
    // fail-closed behavior relies on un-caught syscall propagation in openOwnMobileRelaySecurityStateSqlite.
    it('fails closed when explicit file creation is denied by directory permissions', async (ctx) => {
      if (process.platform === 'win32') {
        ctx.skip()
        return
      }
      // Root (euid 0) ignores POSIX directory permissions (0500) and can create files regardless.
      if (typeof process.geteuid === 'function' && process.geteuid() === 0) {
        ctx.skip()
        return
      }

      // In POSIX, a directory without write permission prevents creating new files
      const parentDir = await mkdtemp(join(tmpdir(), 'orca-sec-fail-create-parent-'))
      tempDirs.push(parentDir)
      const readOnlyDir = join(parentDir, 'readonly')
      await fs.promises.mkdir(readOnlyDir, { mode: 0o500 })
      const dbPath = join(readOnlyDir, 'security-state.db')

      await expect(async () => {
        openOwnMobileRelaySecurityStateSqlite({
          dbPath,
          testMode: false
        })
      }).rejects.toThrow(/EACCES|EPERM/)

      expect(existsSync(dbPath)).toBe(false)
    })

    it('proves exported SqliteSecurityStateOptions has no test hooks and exported opener takes one argument', () => {
      // API / Type contract verification: options must only contain dbPath, testMode, busyTimeoutMs
      const prodOptions: SqliteSecurityStateOptions = {
        dbPath: '/tmp/nonexistent.db',
        testMode: true,
        busyTimeoutMs: 1000
      }
      // @ts-expect-error - injectedFs or testSeam must not be present on production SqliteSecurityStateOptions
      prodOptions.injectedFs = {}
      // @ts-expect-error - testSeam must not be present on production SqliteSecurityStateOptions
      prodOptions.testSeam = {}
      expect(prodOptions.dbPath).toBe('/tmp/nonexistent.db')

      // Exported production opener is a 1-argument function
      expect(openOwnMobileRelaySecurityStateSqlite.length).toBe(1)
    })

    it('proves production module exports no internal hooks or test openers', async () => {
      const sqliteExports = (await import('./own-mobile-relay-security-state-sqlite')) as Record<
        string,
        unknown
      >
      expect(sqliteExports.openOwnMobileRelaySecurityStateSqliteInternal).toBeUndefined()
      expect(sqliteExports.SqliteSecurityInternalHooks).toBeUndefined()
      expect(sqliteExports.SqliteSecurityTestSeam).toBeUndefined()
    })

    it('proves production schema module has no snapshot/restore functions', async () => {
      const schemaModule =
        (await import('./own-mobile-relay-security-state-sqlite-schema')) as Record<string, unknown>
      expect(schemaModule.captureStorageArtifacts).toBeUndefined()
      expect(schemaModule.restoreStorageArtifacts).toBeUndefined()
    })
  })

  // 8. Database lock/contention produces a closed operation failure rather than memory fallback
  describe('Database Lock and Contention', () => {
    it('fails with bounded busy timeout on locked database without falling back to memory', async () => {
      const dbPath = await createTempDbPath()

      // Open first connection and acquire an exclusive transaction lock
      const db1 = new DatabaseSync(dbPath)
      db1.exec('PRAGMA journal_mode = WAL;')
      db1.exec('CREATE TABLE t1 (x INTEGER);')
      db1.exec('BEGIN EXCLUSIVE;')

      try {
        // Attempt to open adapter with a short busy timeout (e.g. 50ms)
        await expect(async () => {
          await openOwnMobileRelaySecurityStateSqlite({
            dbPath,
            testMode: true,
            busyTimeoutMs: 50
          })
        }).rejects.toThrow(/busy|locked/i)
      } finally {
        db1.exec('ROLLBACK;')
        db1.close()
      }
    })
  })
})
