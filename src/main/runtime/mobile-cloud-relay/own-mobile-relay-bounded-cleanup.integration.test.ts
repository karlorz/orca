import { describe, expect, it, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openOwnMobileRelaySecurityStateSqlite } from './own-mobile-relay-security-state-sqlite'
import { createOwnMobileRelaySecurityStateMemory } from './own-mobile-relay-security-state-memory'
import { derivePasswordRecord, TEST_FAST_PASSWORD_POLICY } from './own-mobile-relay-password'
import { RELAY_CLEANUP_BATCH_LIMIT } from './own-mobile-relay-cleanup-scheduler'

describe('own-mobile-relay-bounded-cleanup.integration (Scenario 7)', () => {
  const tempDirs: string[] = []

  function createTempDbPath(): string {
    const dir = mkdtempSync(join(tmpdir(), 'relay-cleanup-'))
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

  it('Scenario 7: Cleanup global bound under >256 expired fixtures in SQLite and memory; validity independent', async () => {
    const dbPath = createTempDbPath()
    const sqliteState = openOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: true })
    const memState = createOwnMobileRelaySecurityStateMemory()

    const pwd = await derivePasswordRecord('operator-pw-123', TEST_FAST_PASSWORD_POLICY)

    for (const state of [sqliteState, memState]) {
      await state.bootstrapAccount({
        email: 'operator@example.com',
        userId: 'u1',
        profileId: 'p1',
        organizationId: 'o1',
        passwordRecord: pwd
      })

      // Create 1 valid session and 1 valid device
      const validSession = await state.issueAccessSession({
        rawAccessToken: 'valid-access-token-stay',
        identity: {
          userId: 'u1',
          profileId: 'p1',
          organizationId: 'o1',
          email: 'operator@example.com',
          cloudProfileId: 'p1'
        },
        ttlMs: 3600_000
      })

      await state.installDeviceCredential({
        relayHostId: 'host-valid-1',
        relayDeviceId: 'dev-valid-1',
        reqId: 'req-v1',
        newResumeTokenHash: 'v'.repeat(43),
        authorizationMode: 'relay-basis',
        resumeTtlMs: 3600_000
      })

      // Insert 300 expired sessions (>256 batch limit)
      for (let i = 0; i < 300; i++) {
        await state.issueAccessSession({
          rawAccessToken: `expired-tok-${i}`,
          identity: {
            userId: 'u1',
            profileId: 'p1',
            organizationId: 'o1',
            email: 'operator@example.com',
            cloudProfileId: 'p1'
          },
          ttlMs: -10_000
        })
      }

      // First cleanup pass with 256 batch limit (matching RELAY_CLEANUP_BATCH_LIMIT)
      const res1 = await state.cleanupExpired({ maxBatchSize: RELAY_CLEANUP_BATCH_LIMIT })
      const totalDeleted1 =
        res1.expiredSessionsDeleted + res1.expiredGrantsDeleted + res1.expiredDevicesDeleted
      expect(totalDeleted1).toBe(256)

      // Verify that valid session and valid device are intact and independent of expired cleanup
      const validLookup = await state.lookupAccessSessionByToken('valid-access-token-stay')
      expect(validLookup).not.toBeNull()
      expect(validLookup?.sessionId).toBe(validSession.sessionId)

      const validDev = await state.matchDeviceCredential('host-valid-1', 'v'.repeat(43))
      expect(validDev).not.toBeNull()
      expect(validDev?.device.relayDeviceId).toBe('dev-valid-1')

      // Second cleanup pass removes remaining 44 expired items
      const res2 = await state.cleanupExpired({ maxBatchSize: RELAY_CLEANUP_BATCH_LIMIT })
      const totalDeleted2 =
        res2.expiredSessionsDeleted + res2.expiredGrantsDeleted + res2.expiredDevicesDeleted
      expect(totalDeleted2).toBe(44)

      // Third cleanup pass has nothing left to delete
      const res3 = await state.cleanupExpired({ maxBatchSize: RELAY_CLEANUP_BATCH_LIMIT })
      const totalDeleted3 =
        res3.expiredSessionsDeleted + res3.expiredGrantsDeleted + res3.expiredDevicesDeleted
      expect(totalDeleted3).toBe(0)

      // Valid records still untouched
      const validLookupAfter = await state.lookupAccessSessionByToken('valid-access-token-stay')
      expect(validLookupAfter).not.toBeNull()

      await state.close()
    }
  })
})
