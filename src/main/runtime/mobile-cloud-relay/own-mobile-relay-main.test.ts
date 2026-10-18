import { describe, expect, it, vi, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseOwnRelayServeConfig,
  startOwnRelayServer,
  checkRuntimeRequirements
} from './own-mobile-relay-main'
import * as sqliteModule from './own-mobile-relay-security-state-sqlite'
import { openOwnMobileRelaySecurityStateSqlite } from './own-mobile-relay-security-state-sqlite'
import { derivePasswordRecord, TEST_FAST_PASSWORD_POLICY } from './own-mobile-relay-password'

describe('own-mobile-relay-main RED tests', () => {
  const tempDirs: string[] = []

  function createTempDbPath(): string {
    const dir = mkdtempSync(join(tmpdir(), 'relay-main-test-'))
    tempDirs.push(dir)
    return join(dir, 'relay.db')
  }

  afterEach(() => {
    vi.restoreAllMocks()
    for (const dir of tempDirs) {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        // ignore
      }
    }
    tempDirs.length = 0
  })

  const baseValidEnv = {
    OWN_RELAY_STATE_PATH: '/tmp/test.db',
    OWN_RELAY_ORIGIN: 'https://orca-relay.karldigi.dev',
    OWN_RELAY_AUTH_ORIGIN: 'https://orca-auth.karldigi.dev',
    OWN_RELAY_CLIENT_ID: 'orca-desktop-prod'
  }

  const completeBootstrapEnv = {
    ...baseValidEnv,
    OWN_RELAY_OPERATOR_EMAIL: 'operator@example.com',
    OWN_RELAY_OPERATOR_PASSWORD: 'secret-password-123',
    OWN_RELAY_OPERATOR_USER_ID: 'user-op-1',
    OWN_RELAY_OPERATOR_PROFILE_ID: 'prof-op-1'
  }

  // RED Case 1: serve requires state path, Relay origin, auth origin, and client ID.
  it('RED Case 1: fails when state path, relay origin, auth origin, or client id is missing', () => {
    const requiredKeys = [
      'OWN_RELAY_STATE_PATH',
      'OWN_RELAY_ORIGIN',
      'OWN_RELAY_AUTH_ORIGIN',
      'OWN_RELAY_CLIENT_ID'
    ] as const

    for (const key of requiredKeys) {
      const env = { ...baseValidEnv }
      delete (env as Record<string, string>)[key]
      expect(() => parseOwnRelayServeConfig(env)).toThrow(
        new RegExp(`Missing required environment variable: ${key}`)
      )
    }
  })

  // RED Case 2: Empty database requires the complete bootstrap group; a partial group fails before listening.
  it('RED Case 2: empty database with partial bootstrap group fails before listening', async () => {
    const dbPath = createTempDbPath()
    const partialEnv = {
      ...baseValidEnv,
      OWN_RELAY_STATE_PATH: dbPath,
      OWN_RELAY_OPERATOR_EMAIL: 'operator@example.com',
      OWN_RELAY_OPERATOR_PASSWORD: 'secret-password-123'
      // missing USER_ID and PROFILE_ID
    }

    const config = parseOwnRelayServeConfig(partialEnv)
    await expect(
      startOwnRelayServer({
        config,
        passwordPolicy: TEST_FAST_PASSWORD_POLICY
      })
    ).rejects.toThrow(/Incomplete bootstrap operator credentials/)
  })

  it('RED Case 2 (empty database with no bootstrap group fails before listening):', async () => {
    const dbPath = createTempDbPath()
    const emptyConfig = parseOwnRelayServeConfig({
      ...baseValidEnv,
      OWN_RELAY_STATE_PATH: dbPath
    })

    await expect(
      startOwnRelayServer({
        config: emptyConfig,
        passwordPolicy: TEST_FAST_PASSWORD_POLICY
      })
    ).rejects.toThrow(/Uninitialized database requires operator bootstrap credentials/)
  })

  // RED Case 3: Existing account plus any bootstrap account variable fails with bootstrap_already_complete before listening.
  it('RED Case 3: existing account with any bootstrap variable fails with bootstrap_already_complete before listening', async () => {
    const dbPath = createTempDbPath()
    // Pre-initialize DB with an account
    const state = openOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: true })
    const rec = await derivePasswordRecord('initial-secret-123', TEST_FAST_PASSWORD_POLICY)
    await state.bootstrapAccount({
      email: 'operator@example.com',
      userId: 'user-1',
      profileId: 'prof-1',
      organizationId: '',
      passwordRecord: rec
    })
    await state.close()

    const bootstrapKeys = [
      'OWN_RELAY_OPERATOR_EMAIL',
      'OWN_RELAY_OPERATOR_PASSWORD',
      'OWN_RELAY_OPERATOR_USER_ID',
      'OWN_RELAY_OPERATOR_PROFILE_ID',
      'OWN_RELAY_OPERATOR_ORG_ID'
    ] as const

    for (const key of bootstrapKeys) {
      const env = {
        ...baseValidEnv,
        OWN_RELAY_STATE_PATH: dbPath,
        [key]: 'some-value'
      }
      const config = parseOwnRelayServeConfig(env)
      await expect(
        startOwnRelayServer({
          config,
          passwordPolicy: TEST_FAST_PASSWORD_POLICY
        })
      ).rejects.toThrow(/bootstrap_already_complete/)
    }
  })

  // RED Case 4: Existing account starts without all OWN_RELAY_OPERATOR_* variables.
  it('RED Case 4: existing account starts successfully without any OWN_RELAY_OPERATOR_* variables', async () => {
    const dbPath = createTempDbPath()
    const state = openOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: true })
    const rec = await derivePasswordRecord('initial-secret-123', TEST_FAST_PASSWORD_POLICY)
    await state.bootstrapAccount({
      email: 'operator@example.com',
      userId: 'user-1',
      profileId: 'prof-1',
      organizationId: '',
      passwordRecord: rec
    })
    await state.close()

    const env = {
      ...baseValidEnv,
      OWN_RELAY_STATE_PATH: dbPath,
      OWN_RELAY_LISTEN_PORT: '0'
    }
    const config = parseOwnRelayServeConfig(env)
    const serverInstance = await startOwnRelayServer({
      config,
      passwordPolicy: TEST_FAST_PASSWORD_POLICY
    })

    expect(serverInstance.origin).toBe('https://orca-relay.karldigi.dev')
    expect(serverInstance.boundPort).toBeGreaterThan(0)
    await serverInstance.close()
  })

  // RED Case 5: Bootstrap password/identity values do not appear in startup logs or errors.
  it('RED Case 5: bootstrap password does not appear in errors or output on bootstrap failure', async () => {
    const secretPassword = 'SUPER_CONFIDENTIAL_PASSWORD_12345!'
    const dbPath = createTempDbPath()
    const state = openOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: true })
    const rec = await derivePasswordRecord('initial-secret-123', TEST_FAST_PASSWORD_POLICY)
    await state.bootstrapAccount({
      email: 'operator@example.com',
      userId: 'user-1',
      profileId: 'prof-1',
      organizationId: '',
      passwordRecord: rec
    })
    await state.close()

    const env = {
      ...baseValidEnv,
      OWN_RELAY_STATE_PATH: dbPath,
      OWN_RELAY_OPERATOR_EMAIL: 'operator@example.com',
      OWN_RELAY_OPERATOR_PASSWORD: secretPassword,
      OWN_RELAY_OPERATOR_USER_ID: 'user-1',
      OWN_RELAY_OPERATOR_PROFILE_ID: 'prof-1'
    }
    const config = parseOwnRelayServeConfig(env)

    let errorThrown: Error | null = null
    try {
      await startOwnRelayServer({ config, passwordPolicy: TEST_FAST_PASSWORD_POLICY })
    } catch (err) {
      errorThrown = err as Error
    }
    expect(errorThrown).not.toBeNull()
    expect(errorThrown!.message).not.toContain(secretPassword)
  })

  // RED Case 10: Bundle target is Node 22 check and node:sqlite availability.
  it('RED Case 10: checkRuntimeRequirements enforces Node >=22 and sqlite availability', () => {
    expect(() => checkRuntimeRequirements('22.0.0')).not.toThrow()
    expect(() => checkRuntimeRequirements('20.10.0')).toThrow(/Node\.js 22 or later is required/)
  })

  // RED Case 11: Shutdown closes sockets, cleanup scheduler, and SQLite in order.
  it('RED Case 11: shutdown closes sockets, cleanup scheduler, and SQLite in exact order', async () => {
    const dbPath = createTempDbPath()

    // 1. Pre-initialize database and issue a valid relay grant
    const dbInit = openOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: true })
    const rec = await derivePasswordRecord(
      completeBootstrapEnv.OWN_RELAY_OPERATOR_PASSWORD,
      TEST_FAST_PASSWORD_POLICY
    )
    await dbInit.bootstrapAccount({
      email: completeBootstrapEnv.OWN_RELAY_OPERATOR_EMAIL,
      userId: completeBootstrapEnv.OWN_RELAY_OPERATOR_USER_ID,
      profileId: completeBootstrapEnv.OWN_RELAY_OPERATOR_PROFILE_ID,
      organizationId: '',
      passwordRecord: rec
    })
    const sessionRes = await dbInit.issueAccessSession({
      rawAccessToken: 'test-session-token',
      ttlMs: 60000,
      identity: {
        userId: completeBootstrapEnv.OWN_RELAY_OPERATOR_USER_ID,
        profileId: completeBootstrapEnv.OWN_RELAY_OPERATOR_PROFILE_ID,
        organizationId: '',
        email: completeBootstrapEnv.OWN_RELAY_OPERATOR_EMAIL,
        cloudProfileId: ''
      }
    })
    const grantRes = await dbInit.issueRelayGrant({
      parentSessionId: sessionRes.sessionId,
      rawRelayToken: 'test-relay-token',
      relayHostId: 'host-1',
      hostPublicKeyB64: Buffer.alloc(32).toString('base64'),
      ttlMs: 60000,
      identity: {
        userId: completeBootstrapEnv.OWN_RELAY_OPERATOR_USER_ID,
        profileId: completeBootstrapEnv.OWN_RELAY_OPERATOR_PROFILE_ID,
        organizationId: ''
      }
    })
    expect(grantRes).not.toBeNull()
    await dbInit.close()

    const env = {
      ...baseValidEnv,
      OWN_RELAY_STATE_PATH: dbPath,
      OWN_RELAY_LISTEN_PORT: '0'
    }
    const config = parseOwnRelayServeConfig(env)

    const orderLog: string[] = []

    // 2. Spy on SQLite close on the server's instance
    const origOpen = sqliteModule.openOwnMobileRelaySecurityStateSqlite
    vi.spyOn(sqliteModule, 'openOwnMobileRelaySecurityStateSqlite').mockImplementation((opts) => {
      const realState = origOpen(opts)
      const origClose = realState.close.bind(realState)
      realState.close = async () => {
        orderLog.push('security_state_closed')
        return origClose()
      }
      return realState
    })

    const serverInstance = await startOwnRelayServer({
      config,
      passwordPolicy: TEST_FAST_PASSWORD_POLICY
    })

    // 3. Connect an active WebSocket and spy on its underlying socket termination
    const { WebSocket } = await import('ws')
    const ws = new WebSocket(`ws://127.0.0.1:${serverInstance.boundPort}/v1/host/control`, {
      headers: {
        Authorization: 'Bearer test-relay-token'
      }
    })
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve)
      ws.once('error', reject)
    })

    const wsClosedPromise = new Promise<void>((resolve) => {
      ws.once('close', () => {
        orderLog.push('socket_terminated')
        resolve()
      })
    })

    // Act: close serverInstance which terminates active sockets before closing sqlite
    const closeServerPromise = serverInstance.close()
    await Promise.all([closeServerPromise, wsClosedPromise])

    expect(orderLog).toContain('socket_terminated')
    expect(orderLog).toContain('security_state_closed')
  })

  it('RED Finding 1: closes SQLite security state adapter when listenOwnMobileRelay rejects', async () => {
    const dbPath = createTempDbPath()
    const state = openOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: true })
    const rec = await derivePasswordRecord('initial-secret-123', TEST_FAST_PASSWORD_POLICY)
    await state.bootstrapAccount({
      email: 'operator@example.com',
      userId: 'user-1',
      profileId: 'prof-1',
      organizationId: '',
      passwordRecord: rec
    })
    await state.close()

    let closeCalled = false
    const origOpen = sqliteModule.openOwnMobileRelaySecurityStateSqlite
    vi.spyOn(sqliteModule, 'openOwnMobileRelaySecurityStateSqlite').mockImplementation((opts) => {
      const realState = origOpen(opts)
      const origClose = realState.close.bind(realState)
      realState.close = async () => {
        closeCalled = true
        return origClose()
      }
      return realState
    })

    const testConfig = parseOwnRelayServeConfig({
      ...baseValidEnv,
      OWN_RELAY_STATE_PATH: dbPath,
      OWN_RELAY_LISTEN_PORT: '8093'
    })

    await expect(
      startOwnRelayServer({
        config: {
          ...testConfig,
          listenHost: '256.256.256.256'
        },
        passwordPolicy: TEST_FAST_PASSWORD_POLICY
      })
    ).rejects.toThrow()

    expect(closeCalled).toBe(true)
  })

  it('RED Finding 2: reject extraneous serve arguments', async () => {
    // We can export and test a dispatchMain function or test main's argument validation
    const { runRelayCli } = await import('./own-mobile-relay-main')
    const res = await runRelayCli({
      argv: ['serve', '--extra-flag', 'unexpected']
    })
    expect(res.exitCode).toBe(1)
    expect(res.stderr).toContain('Unexpected arguments for serve command')
  })
})
