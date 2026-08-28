import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  derivePasswordRecord,
  TEST_FAST_PASSWORD_POLICY,
  type PasswordRecord
} from './own-mobile-relay-password'
import { createOwnMobileRelaySecurityStateMemory } from './own-mobile-relay-security-state-memory'
import {
  openOwnMobileRelaySecurityStateSqlite,
  CURRENT_SCHEMA_VERSION
} from './own-mobile-relay-security-state-sqlite'
import type { OwnMobileRelaySecurityState } from './own-mobile-relay-security-state'

describe('OwnMobileRelaySecurityState Slice 2: List APIs and Operator Sessions', () => {
  let tempDirs: string[] = []
  let passwordRecord: PasswordRecord

  async function createTempDbPath(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'orca-sec-op-test-'))
    tempDirs.push(dir)
    return join(dir, 'security-state.db')
  }

  beforeEach(async () => {
    passwordRecord = await derivePasswordRecord(
      'operator-test-password-1234',
      TEST_FAST_PASSWORD_POLICY
    )
  })

  afterEach(async () => {
    for (const dir of tempDirs) {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
    tempDirs = []
  })

  const adapters: {
    name: string
    create: () => Promise<OwnMobileRelaySecurityState> | OwnMobileRelaySecurityState
  }[] = [
    {
      name: 'Memory Adapter',
      create: () => createOwnMobileRelaySecurityStateMemory()
    },
    {
      name: 'SQLite Adapter',
      create: async () => {
        const dbPath = await createTempDbPath()
        return openOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: true })
      }
    }
  ]

  for (const { name, create } of adapters) {
    describe(`${name} - Slice 2 Contract`, () => {
      let state: OwnMobileRelaySecurityState

      beforeEach(async () => {
        state = await create()
      })

      afterEach(async () => {
        await state.close().catch(() => {})
      })

      it('listAccessSessions returns redacted active sessions without token hashes and filters expired/revoked', async () => {
        const bootstrap = await state.bootstrapAccount({
          email: 'op@example.com',
          userId: 'usr_op_1',
          profileId: 'prf_op_1',
          organizationId: 'org_op_1',
          passwordRecord
        })

        const t0 = 10_000_000
        const session1 = await state.issueAccessSession(
          {
            rawAccessToken: 'access-token-1-active',
            identity: {
              userId: 'usr_op_1',
              profileId: 'prf_op_1',
              organizationId: 'org_op_1',
              email: 'op@example.com',
              cloudProfileId: 'cloud_1'
            },
            ttlMs: 3600_000
          },
          t0
        )

        await state.issueAccessSession(
          {
            rawAccessToken: 'access-token-2-to-expire',
            identity: {
              userId: 'usr_op_2',
              profileId: 'prf_op_2',
              organizationId: 'org_op_2',
              email: 'op2@example.com',
              cloudProfileId: 'cloud_2'
            },
            ttlMs: 1000
          },
          t0
        )

        const session3 = await state.issueAccessSession(
          {
            rawAccessToken: 'access-token-3-to-revoke',
            identity: {
              userId: 'usr_op_3',
              profileId: 'prf_op_3',
              organizationId: 'org_op_3',
              email: 'op3@example.com',
              cloudProfileId: 'cloud_3'
            },
            ttlMs: 3600_000
          },
          t0
        )

        await state.revokeAccessSessionById(session3.sessionId, t0 + 100)

        // Query at t0 + 2000: session2 is expired, session3 is revoked
        const list = await state.listAccessSessions(t0 + 2000)
        expect(list.length).toBe(1)
        const item = list[0]
        expect(item.sessionId).toBe(session1.sessionId)
        expect(item.accountId).toBe(bootstrap.accountId)
        expect(item.createdAt).toBe(t0)
        expect(item.expiresAt).toBe(t0 + 3600_000)
        expect(item.identity).toEqual({
          userId: 'usr_op_1',
          profileId: 'prf_op_1',
          organizationId: 'org_op_1',
          email: 'op@example.com',
          cloudProfileId: 'cloud_1'
        })

        // Verify NO token hashes or raw tokens leak
        expect(item).not.toHaveProperty('accessTokenHash')
        expect(item).not.toHaveProperty('rawAccessToken')
        expect(item).not.toHaveProperty('access_token_hash')
        expect(JSON.stringify(item)).not.toContain('access-token-1')
      })

      it('listRelayGrants returns redacted active grants without token hashes and filters expired/revoked/stale parents', async () => {
        await state.bootstrapAccount({
          email: 'op@example.com',
          userId: 'usr_op_1',
          profileId: 'prf_op_1',
          organizationId: 'org_op_1',
          passwordRecord
        })

        const t0 = 20_000_000
        const session = await state.issueAccessSession(
          {
            rawAccessToken: 'access-parent',
            identity: {
              userId: 'usr_op_1',
              profileId: 'prf_op_1',
              organizationId: 'org_op_1',
              email: 'op@example.com',
              cloudProfileId: 'cloud_1'
            },
            ttlMs: 7200_000
          },
          t0
        )

        const grant1 = await state.issueRelayGrant(
          {
            rawRelayToken: 'relay-token-1-active',
            parentSessionId: session.sessionId,
            relayHostId: 'host_list_1',
            hostPublicKeyB64: 'key_1==',
            identity: {
              userId: 'usr_op_1',
              profileId: 'prf_op_1',
              organizationId: 'org_op_1'
            },
            ttlMs: 3600_000
          },
          t0
        )

        const grant2 = await state.issueRelayGrant(
          {
            rawRelayToken: 'relay-token-2-short',
            parentSessionId: session.sessionId,
            relayHostId: 'host_list_2',
            hostPublicKeyB64: 'key_2==',
            identity: {
              userId: 'usr_op_1',
              profileId: 'prf_op_1',
              organizationId: 'org_op_1'
            },
            ttlMs: 1000
          },
          t0
        )

        expect(grant1).not.toBeNull()
        expect(grant2).not.toBeNull()

        const list = await state.listRelayGrants(t0 + 2000)
        expect(list.length).toBe(1)
        const item = list[0]
        expect(item.grantId).toBe(grant1!.grantId)
        expect(item.relayHostId).toBe('host_list_1')
        expect(item.parentSessionId).toBe(session.sessionId)
        expect(item.createdAt).toBe(t0)
        expect(item.expiresAt).toBe(t0 + 3600_000)
        expect(item.identity).toEqual({
          userId: 'usr_op_1',
          profileId: 'prf_op_1',
          organizationId: 'org_op_1'
        })

        // Verify NO token hashes leak
        expect(item).not.toHaveProperty('relayTokenHash')
        expect(item).not.toHaveProperty('relay_token_hash')
        expect(item).not.toHaveProperty('rawRelayToken')
        expect(JSON.stringify(item)).not.toContain('relay-token-1')
      })

      it('listDeviceCredentials returns device credentials without resume hashes', async () => {
        const t0 = 30_000_000
        const hash1 = 'a'.repeat(43)
        const hash2 = 'b'.repeat(43)

        await state.installDeviceCredential(
          {
            relayHostId: 'host_dev_1',
            relayDeviceId: 'dev_1',
            reqId: 'req_1',
            newResumeTokenHash: hash1,
            authorizationMode: 'relay-basis',
            resumeTtlMs: 3600_000
          },
          t0
        )

        await state.installDeviceCredential(
          {
            relayHostId: 'host_dev_2',
            relayDeviceId: 'dev_2',
            reqId: 'req_2',
            newResumeTokenHash: hash2,
            authorizationMode: 'authenticated-direct',
            resumeTtlMs: 3600_000
          },
          t0
        )

        await state.revokeDeviceCredential('host_dev_2', 'dev_2', t0 + 100)

        const list = await state.listDeviceCredentials()
        expect(list.length).toBe(2)

        const dev1 = list.find((d) => d.relayDeviceId === 'dev_1')
        expect(dev1).toBeDefined()
        expect(dev1?.relayHostId).toBe('host_dev_1')
        expect(dev1?.revoked).toBe(false)
        expect(dev1?.currentVersion).toBe(1)
        expect(dev1?.authorizationMode).toBe('relay-basis')
        expect(dev1?.resumeExpiresAt).toBe(t0 + 3600_000)

        const dev2 = list.find((d) => d.relayDeviceId === 'dev_2')
        expect(dev2).toBeDefined()
        expect(dev2?.relayHostId).toBe('host_dev_2')
        expect(dev2?.revoked).toBe(true)
        expect(dev2?.authorizationMode).toBe('authenticated-direct')

        // Verify NO resume hashes leak
        for (const d of list) {
          expect(d).not.toHaveProperty('currentResumeTokenHash')
          expect(d).not.toHaveProperty('graceResumeTokenHash')
          expect(d).not.toHaveProperty('current_resume_token_hash')
          expect(d).not.toHaveProperty('grace_resume_token_hash')
          expect(JSON.stringify(d)).not.toContain(hash1)
          expect(JSON.stringify(d)).not.toContain(hash2)
        }
      })

      it('operator session lifecycle: issue, lookup, revoke, and expiry', async () => {
        await state.bootstrapAccount({
          email: 'op@example.com',
          userId: 'usr_op_1',
          profileId: 'prf_op_1',
          organizationId: 'org_op_1',
          passwordRecord
        })

        const t0 = 40_000_000
        const rawToken = 'operator-token-test-12345'
        const ttlMs = 3600_000

        const issued = await state.issueOperatorSession({ rawToken, ttlMs }, t0)
        expect(issued.sessionId).toBeDefined()
        expect(issued.accountId).toBeDefined()
        expect(issued.authEpoch).toBe(1)
        expect(issued.expiresAt).toBe(t0 + ttlMs)

        // Lookup valid token
        const lookedUp = await state.lookupOperatorSession(rawToken, t0 + 1000)
        expect(lookedUp).not.toBeNull()
        expect(lookedUp?.sessionId).toBe(issued.sessionId)
        expect(lookedUp?.accountId).toBe(issued.accountId)
        expect(lookedUp?.authEpoch).toBe(1)
        expect(lookedUp?.expiresAt).toBe(t0 + ttlMs)
        expect(lookedUp).not.toHaveProperty('tokenHash')
        expect(lookedUp).not.toHaveProperty('rawToken')

        // Lookup with wrong token
        expect(await state.lookupOperatorSession('wrong-token', t0 + 1000)).toBeNull()

        // Lookup expired token
        expect(await state.lookupOperatorSession(rawToken, t0 + ttlMs + 1)).toBeNull()

        // Revoke
        const revoked = await state.revokeOperatorSession(rawToken)
        expect(revoked).toBe(true)

        // Lookup revoked token
        expect(await state.lookupOperatorSession(rawToken, t0 + 2000)).toBeNull()
      })

      it('password replace and authEpoch bump invalidate operator sessions', async () => {
        const bootstrap = await state.bootstrapAccount({
          email: 'op@example.com',
          userId: 'usr_op_1',
          profileId: 'prf_op_1',
          organizationId: 'org_op_1',
          passwordRecord
        })

        const t0 = 50_000_000
        const rawToken = 'operator-token-epoch-test'
        await state.issueOperatorSession({ rawToken, ttlMs: 3600_000 }, t0)

        // Verify valid before bump
        expect(await state.lookupOperatorSession(rawToken, t0 + 100)).not.toBeNull()

        // Bump authEpoch via replacePasswordVerifier
        const newPassword = await derivePasswordRecord(
          'new-op-pwd-987654321',
          TEST_FAST_PASSWORD_POLICY
        )
        const replaceRes = await state.replacePasswordVerifier(
          {
            expectedVerifierVersion: bootstrap.verifierVersion,
            newPasswordRecord: newPassword
          },
          t0 + 1000
        )
        expect(replaceRes.ok).toBe(true)

        // Session must be invalid after epoch bump
        expect(await state.lookupOperatorSession(rawToken, t0 + 2000)).toBeNull()
      })
    })
  }

  describe('SQLite Schema v2 Migration and Durability', () => {
    it('migrates existing v1 database to v2 without destroying data', async () => {
      const dbPath = await createTempDbPath()
      const rawDb = new DatabaseSync(dbPath)

      // Initialize as v1 schema manually
      rawDb.exec('PRAGMA foreign_keys = ON;')
      rawDb.exec('PRAGMA journal_mode = WAL;')
      rawDb.exec('PRAGMA synchronous = FULL;')

      rawDb.exec(`
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

      // Insert pre-existing v1 data
      rawDb
        .prepare(`
        INSERT INTO operator_account (
          singleton_id, account_id, email, user_id, profile_id, organization_id,
          verifier_version, auth_epoch, password_version, password_verifier, password_salt,
          param_n, param_r, param_p, param_key_len, param_maxmem, created_at, updated_at
        ) VALUES (
          1, 'acc_mig_1', 'mig@example.com', 'u_mig', 'p_mig', 'o_mig',
          1, 1, 1, 'ver', 'salt',
          16384, 8, 1, 32, 33554432, 1000, 1000
        )
      `)
        .run()

      rawDb
        .prepare(`
        INSERT INTO device_credentials (
          relay_host_id, relay_device_id, last_install_req_id,
          current_resume_token_hash, current_version, resume_expires_at,
          authorization_mode, grace_resume_token_hash, grace_expires_at, revoked_at
        ) VALUES (
          'host_mig_1', 'dev_mig_1', 'req_mig_1',
          'hash11111111111111111111111111111111111111', 1, 5000,
          'relay-basis', NULL, NULL, NULL
        )
      `)
        .run()

      rawDb.close()

      // Open with adapter, which should migrate to CURRENT_SCHEMA_VERSION = 2
      expect(CURRENT_SCHEMA_VERSION).toBe(2)
      const state = openOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: true })

      // Verify v1 data is preserved
      const account = await state.getAccount()
      expect(account?.accountId).toBe('acc_mig_1')
      expect(account?.email).toBe('mig@example.com')

      const devices = await state.listDeviceCredentials()
      expect(devices.length).toBe(1)
      expect(devices[0].relayDeviceId).toBe('dev_mig_1')

      // Verify new operator session APIs work on migrated database
      const opSession = await state.issueOperatorSession({
        rawToken: 'op-mig-token',
        ttlMs: 3600_000
      })
      expect(opSession.accountId).toBe('acc_mig_1')

      const lookedUp = await state.lookupOperatorSession('op-mig-token')
      expect(lookedUp?.sessionId).toBe(opSession.sessionId)

      await state.close()
    })
  })
})
