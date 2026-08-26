import { describe, expect, it, vi, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runAccountCli, type AccountCliPromptInterface } from './own-mobile-relay-account-cli'
import { openOwnMobileRelaySecurityStateSqlite } from './own-mobile-relay-security-state-sqlite'
import {
  derivePasswordRecord,
  verifyPasswordRecord,
  TEST_FAST_PASSWORD_POLICY
} from './own-mobile-relay-password'

describe('own-mobile-relay-account-cli RED tests', () => {
  const tempDirs: string[] = []

  function createTempDbPath(): string {
    const dir = mkdtempSync(join(tmpdir(), 'relay-cli-test-'))
    tempDirs.push(dir)
    return join(dir, 'relay.db')
  }

  async function seedOperatorAccount(dbPath: string, password = 'current-password-123') {
    const state = openOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: true })
    const rec = await derivePasswordRecord(password, TEST_FAST_PASSWORD_POLICY)
    await state.bootstrapAccount({
      email: 'operator@example.com',
      userId: 'user-1',
      profileId: 'prof-1',
      organizationId: '',
      passwordRecord: rec
    })
    return state
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

  // RED Case 6: CLI change requires TTY, current password, and matching new-password confirmation.
  it('RED Case 6: change-password rejects non-TTY input', async () => {
    const dbPath = createTempDbPath()
    const state = await seedOperatorAccount(dbPath)
    await state.close()

    const mockPrompt: AccountCliPromptInterface = {
      isTTY: () => false,
      promptSecret: vi.fn()
    }

    const res = await runAccountCli({
      args: ['change-password'],
      env: { OWN_RELAY_STATE_PATH: dbPath },
      prompt: mockPrompt,
      passwordPolicy: TEST_FAST_PASSWORD_POLICY
    })

    expect(res.exitCode).toBe(1)
    expect(res.stderr).toContain('Interactive TTY required')
  })

  it('RED Case 6: change-password prompts for current password, new password, and confirmation, updating the record', async () => {
    const dbPath = createTempDbPath()
    const state = await seedOperatorAccount(dbPath, 'old-secret-password-123')
    await state.close()

    const prompts: string[] = []
    const mockPrompt: AccountCliPromptInterface = {
      isTTY: () => true,
      promptSecret: vi.fn(async (label: string) => {
        prompts.push(label)
        if (label.toLowerCase().includes('current')) {
          return 'old-secret-password-123'
        }
        if (label.toLowerCase().includes('confirm')) {
          return 'new-secret-password-456'
        }
        return 'new-secret-password-456'
      })
    }

    const res = await runAccountCli({
      args: ['change-password'],
      env: { OWN_RELAY_STATE_PATH: dbPath },
      prompt: mockPrompt,
      passwordPolicy: TEST_FAST_PASSWORD_POLICY
    })

    expect(res.exitCode).toBe(0)
    expect(res.stdout).toContain('Password changed successfully')
    expect(mockPrompt.promptSecret).toHaveBeenCalledTimes(3)

    // Verify DB was updated
    const verifyState = openOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: true })
    const rec = await verifyState.getAccountPasswordRecord()
    expect(rec).not.toBeNull()
    const checkOld = await verifyPasswordRecord(
      'old-secret-password-123',
      rec!.passwordRecord,
      TEST_FAST_PASSWORD_POLICY
    )
    expect(checkOld.valid).toBe(false)
    const checkNew = await verifyPasswordRecord(
      'new-secret-password-456',
      rec!.passwordRecord,
      TEST_FAST_PASSWORD_POLICY
    )
    expect(checkNew.valid).toBe(true)
    await verifyState.close()
  })

  it('RED Case 6: change-password fails if new password confirmation does not match', async () => {
    const dbPath = createTempDbPath()
    const state = await seedOperatorAccount(dbPath, 'old-secret-password-123')
    await state.close()

    const mockPrompt: AccountCliPromptInterface = {
      isTTY: () => true,
      promptSecret: vi.fn(async (label: string) => {
        if (label.toLowerCase().includes('current')) {
          return 'old-secret-password-123'
        }
        if (label.toLowerCase().includes('confirm')) {
          return 'mismatch-secret-789'
        }
        return 'new-secret-password-456'
      })
    }

    const res = await runAccountCli({
      args: ['change-password'],
      env: { OWN_RELAY_STATE_PATH: dbPath },
      prompt: mockPrompt,
      passwordPolicy: TEST_FAST_PASSWORD_POLICY
    })

    expect(res.exitCode).toBe(1)
    expect(res.stderr).toContain('Passwords do not match')
  })

  it('RED Case 6: change-password fails if current password is incorrect', async () => {
    const dbPath = createTempDbPath()
    const state = await seedOperatorAccount(dbPath, 'old-secret-password-123')
    await state.close()

    const mockPrompt: AccountCliPromptInterface = {
      isTTY: () => true,
      promptSecret: vi.fn(async (label: string) => {
        if (label.toLowerCase().includes('current')) {
          return 'wrong-current-password'
        }
        return 'new-secret-password-456'
      })
    }

    const res = await runAccountCli({
      args: ['change-password'],
      env: { OWN_RELAY_STATE_PATH: dbPath },
      prompt: mockPrompt,
      passwordPolicy: TEST_FAST_PASSWORD_POLICY
    })

    expect(res.exitCode).toBe(1)
    expect(res.stderr).toContain('Current password verification failed')
  })

  // RED Case 7: CLI reset requires TTY but not current password.
  it('RED Case 7: reset-password prompts only for new password and confirmation (not current password)', async () => {
    const dbPath = createTempDbPath()
    const state = await seedOperatorAccount(dbPath, 'forgotten-password-123')
    await state.close()

    const prompts: string[] = []
    const mockPrompt: AccountCliPromptInterface = {
      isTTY: () => true,
      promptSecret: vi.fn(async (label: string) => {
        prompts.push(label)
        return 'brand-new-reset-password-123'
      })
    }

    const res = await runAccountCli({
      args: ['reset-password'],
      env: { OWN_RELAY_STATE_PATH: dbPath },
      prompt: mockPrompt,
      passwordPolicy: TEST_FAST_PASSWORD_POLICY
    })

    expect(res.exitCode).toBe(0)
    expect(res.stdout).toContain('Password reset successfully')
    expect(mockPrompt.promptSecret).toHaveBeenCalledTimes(2)
    expect(prompts.every((p) => !p.toLowerCase().includes('current'))).toBe(true)

    // Verify DB
    const verifyState = openOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: true })
    const rec = await verifyState.getAccountPasswordRecord()
    expect(rec).not.toBeNull()
    const checkNew = await verifyPasswordRecord(
      'brand-new-reset-password-123',
      rec!.passwordRecord,
      TEST_FAST_PASSWORD_POLICY
    )
    expect(checkNew.valid).toBe(true)
    await verifyState.close()
  })

  // RED Case 8: Both commands reject password options and secret-bearing environment variables beyond the explicitly allowed first-bootstrap serve path.
  it('RED Case 8: rejects secret-bearing CLI arguments or flags', async () => {
    const dbPath = createTempDbPath()
    const state = await seedOperatorAccount(dbPath)
    await state.close()

    const mockPrompt: AccountCliPromptInterface = {
      isTTY: () => true,
      promptSecret: vi.fn()
    }

    const resWithFlag = await runAccountCli({
      args: ['change-password', '--password', 'secret123'],
      env: { OWN_RELAY_STATE_PATH: dbPath },
      prompt: mockPrompt,
      passwordPolicy: TEST_FAST_PASSWORD_POLICY
    })
    expect(resWithFlag.exitCode).toBe(1)
    expect(resWithFlag.stderr).toContain('Unexpected option or argument')

    const resWithExtraArg = await runAccountCli({
      args: ['reset-password', 'my-secret-pw'],
      env: { OWN_RELAY_STATE_PATH: dbPath },
      prompt: mockPrompt,
      passwordPolicy: TEST_FAST_PASSWORD_POLICY
    })
    expect(resWithExtraArg.exitCode).toBe(1)
    expect(resWithExtraArg.stderr).toContain('Unexpected option or argument')
  })

  it('RED Case 8: rejects secret-bearing environment variables during account CLI commands', async () => {
    const dbPath = createTempDbPath()
    const state = await seedOperatorAccount(dbPath)
    await state.close()

    const mockPrompt: AccountCliPromptInterface = {
      isTTY: () => true,
      promptSecret: vi.fn()
    }

    const res = await runAccountCli({
      args: ['change-password'],
      env: {
        OWN_RELAY_STATE_PATH: dbPath,
        OWN_RELAY_OPERATOR_PASSWORD: 'secret-in-env'
      },
      prompt: mockPrompt,
      passwordPolicy: TEST_FAST_PASSWORD_POLICY
    })
    expect(res.exitCode).toBe(1)
    expect(res.stderr).toContain('Secret environment variables not permitted for account CLI')
  })

  // RED Case 9: Both commands use shared account operation, revoke sessions/grants, preserve device credentials, and report non-secret outcomes.
  it('RED Case 9: shared account operations revoke sessions/grants, preserve device credentials, report non-secret outcomes', async () => {
    const dbPath = createTempDbPath()
    const state = await seedOperatorAccount(dbPath, 'current-password-123')

    // Issue an active session and relay grant
    const session = await state.issueAccessSession({
      rawAccessToken: 'desktop-token-123',
      identity: {
        userId: 'user-1',
        profileId: 'prof-1',
        organizationId: '',
        email: 'operator@example.com',
        cloudProfileId: 'prof-1'
      },
      ttlMs: 60_000
    })
    await state.issueRelayGrant({
      rawRelayToken: 'relay-token-123',
      parentSessionId: session.sessionId,
      relayHostId: 'host-1',
      hostPublicKeyB64: 'key-1',
      identity: {
        userId: 'user-1',
        profileId: 'prof-1',
        organizationId: ''
      },
      ttlMs: 60_000
    })

    // Install a device credential
    const tokenHash = 'a'.repeat(43)
    const devInstall = await state.installDeviceCredential({
      relayHostId: 'host-1',
      relayDeviceId: 'dev-1',
      reqId: 'req-1',
      newResumeTokenHash: tokenHash,
      authorizationMode: 'relay-basis'
    })
    expect(devInstall.ok).toBe(true)
    await state.close()

    const secretInStdoutCheck = 'brand-new-secret-password-xyz'
    const mockPrompt: AccountCliPromptInterface = {
      isTTY: () => true,
      promptSecret: vi.fn(async () => secretInStdoutCheck)
    }

    const res = await runAccountCli({
      args: ['reset-password'],
      env: { OWN_RELAY_STATE_PATH: dbPath },
      prompt: mockPrompt,
      passwordPolicy: TEST_FAST_PASSWORD_POLICY
    })

    expect(res.exitCode).toBe(0)
    expect(res.stdout).not.toContain(secretInStdoutCheck)
    expect(res.stdout).toContain('Password reset successfully')

    // Verify session and grant are revoked, device is intact
    const verifyState = openOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: true })
    const sessionLookup = await verifyState.lookupAccessSessionByToken('desktop-token-123')
    expect(sessionLookup).toBeNull()

    const grantLookup = await verifyState.validateRelayGrantByToken('relay-token-123')
    expect(grantLookup).toBeNull()

    const devMatch = await verifyState.matchDeviceCredential('host-1', tokenHash)
    expect(devMatch).not.toBeNull()
    expect(devMatch?.device.relayDeviceId).toBe('dev-1')

    const account = await verifyState.getAccount()
    expect(account?.authEpoch).toBe(2)
    await verifyState.close()
  })

  // RED Finding 3: promptSecretFromStreams restores raw mode/listeners and handles errors
  it('RED Finding 3: promptSecretFromStreams cleans up listeners and rejects on stream error', async () => {
    const { promptSecretFromStreams } = await import('./own-mobile-relay-account-cli')
    const { EventEmitter } = await import('node:events')

    class FakeStdin extends EventEmitter {
      isTTY = true
      isRaw = false
      setRawMode(val: boolean) {
        this.isRaw = val
      }
      resume() {}
      pause() {}
      setEncoding() {}
    }

    const fakeStdin = new FakeStdin()
    let written = ''
    const fakeStdout = {
      write: (data: string) => {
        written += data
      }
    }

    const promise = promptSecretFromStreams(
      'Enter password: ',
      fakeStdin as unknown as NodeJS.ReadStream,
      fakeStdout as unknown as NodeJS.WriteStream
    )
    expect(fakeStdin.isRaw).toBe(true)

    // Emit error on stdin
    fakeStdin.emit('error', new Error('stdin_read_failure'))

    await expect(promise).rejects.toThrow('stdin_read_failure')
    // Must restore raw mode
    expect(fakeStdin.isRaw).toBe(false)
    // Must remove data listener
    expect(fakeStdin.listenerCount('data')).toBe(0)
    expect(fakeStdin.listenerCount('error')).toBe(0)
  })

  it('RED Finding 3: promptSecretFromStreams handles EOF / end event without newline', async () => {
    const { promptSecretFromStreams } = await import('./own-mobile-relay-account-cli')
    const { EventEmitter } = await import('node:events')

    class FakeStdin extends EventEmitter {
      isTTY = true
      isRaw = false
      setRawMode(val: boolean) {
        this.isRaw = val
      }
      resume() {}
      pause() {}
      setEncoding() {}
    }

    const fakeStdin = new FakeStdin()
    let written = ''
    const fakeStdout = {
      write: (data: string) => {
        written += data
      }
    }

    const promise = promptSecretFromStreams(
      'Enter password: ',
      fakeStdin as unknown as NodeJS.ReadStream,
      fakeStdout as unknown as NodeJS.WriteStream
    )
    fakeStdin.emit('data', 'mysecret')
    fakeStdin.emit('end')

    const result = await promise
    expect(result).toBe('mysecret')
    expect(fakeStdin.isRaw).toBe(false)
    expect(fakeStdin.listenerCount('data')).toBe(0)
  })
})
