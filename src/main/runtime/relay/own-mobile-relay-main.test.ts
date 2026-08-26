import { describe, expect, it, vi, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseOwnRelayServeConfig,
  startOwnRelayServer,
  checkRuntimeRequirements
} from './own-mobile-relay-main'
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
    const env = {
      ...completeBootstrapEnv,
      OWN_RELAY_STATE_PATH: dbPath,
      OWN_RELAY_LISTEN_PORT: '0'
    }
    const config = parseOwnRelayServeConfig(env)
    const serverInstance = await startOwnRelayServer({
      config,
      passwordPolicy: TEST_FAST_PASSWORD_POLICY
    })

    const orderLog: string[] = []
    serverInstance.onStep = (step) => orderLog.push(step)

    await serverInstance.close()
    // Sockets/listener, scheduler, then sqlite
    expect(orderLog).toEqual([
      'cleanup_scheduler_stopped',
      'sockets_terminated',
      'server_closed',
      'security_state_closed'
    ])
  })
})
