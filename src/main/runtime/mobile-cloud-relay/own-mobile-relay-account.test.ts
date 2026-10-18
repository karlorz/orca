import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createOwnMobileRelaySecurityStateMemory } from './own-mobile-relay-security-state-memory'
import { openOwnMobileRelaySecurityStateSqlite } from './own-mobile-relay-security-state-sqlite'
import { bootstrapOperatorAccount } from './own-mobile-relay-account'
import { TEST_FAST_PASSWORD_POLICY } from './own-mobile-relay-password'
import type { OwnMobileRelayOperatorConfig } from './own-mobile-relay-types'

describe('own-mobile-relay-account bootstrap', () => {
  const tempDirs: string[] = []

  function createTempDbPath(): string {
    const dir = mkdtempSync(join(tmpdir(), 'relay-acc-test-'))
    tempDirs.push(dir)
    return join(dir, 'relay.db')
  }

  afterEach(() => {
    for (const dir of tempDirs) {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        // ignore
      }
    }
    tempDirs.length = 0
  })

  const operator: OwnMobileRelayOperatorConfig = {
    email: 'admin@example.com',
    password: 'super-secret-password-123',
    userId: 'usr_admin_1',
    profileId: 'prf_admin_1',
    organizationId: 'org_admin_1'
  }

  it('bootstraps operator account and creates zero access sessions or grants (Case 9)', async () => {
    const state = createOwnMobileRelaySecurityStateMemory()
    try {
      const initial = await bootstrapOperatorAccount(state, operator, TEST_FAST_PASSWORD_POLICY)
      expect(initial.email).toBe(operator.email)
      expect(initial.userId).toBe(operator.userId)
      expect(initial.profileId).toBe(operator.profileId)
      expect(initial.organizationId).toBe(operator.organizationId)
      expect(initial.verifierVersion).toBe(1)
      expect(initial.authEpoch).toBe(1)

      // Verify no sessions or grants exist
      const cleanupRes = await state.cleanupExpired()
      expect(cleanupRes.expiredSessionsDeleted).toBe(0)
      expect(cleanupRes.expiredGrantsDeleted).toBe(0)

      // Subsequent bootstrap returns existing account
      const second = await bootstrapOperatorAccount(state, {
        ...operator,
        email: 'other@example.com'
      })
      expect(second.accountId).toBe(initial.accountId)
      expect(second.email).toBe(operator.email)
    } finally {
      await state.close()
    }
  })

  it('bootstraps first admin even when invited users already exist', async () => {
    const state = openOwnMobileRelaySecurityStateSqlite({
      dbPath: createTempDbPath(),
      testMode: true
    })
    try {
      // Create an invited user before any admin exists
      const invited = await state.inviteAccount({
        email: 'invited-first@example.com',
        userId: 'usr_inv_first',
        profileId: 'prf_inv_first',
        organizationId: 'org_admin_1'
      })
      expect(invited.role).toBe('user')
      expect(invited.status).toBe('invited')

      // bootstrapOperatorAccount should proceed and create the admin
      const admin = await bootstrapOperatorAccount(state, operator, TEST_FAST_PASSWORD_POLICY)
      expect(admin.role).toBe('admin')
      expect(admin.email).toBe(operator.email)
      expect(admin.accountId).not.toBe(invited.accountId)

      // bootstrapOperatorAccount again returns same admin without throw
      const adminAgain = await bootstrapOperatorAccount(
        state,
        {
          ...operator,
          email: 'some-other-input@example.com'
        },
        TEST_FAST_PASSWORD_POLICY
      )
      expect(adminAgain.accountId).toBe(admin.accountId)
      expect(adminAgain.role).toBe('admin')
      expect(adminAgain.email).toBe(operator.email)
    } finally {
      await state.close()
    }
  })

  it('bootstraps admin when invited users exist and subsequent bootstrap returns same admin in memory adapter', async () => {
    const state = createOwnMobileRelaySecurityStateMemory()
    try {
      const invited = await state.inviteAccount({
        email: 'invited-memory-first@example.com',
        userId: 'usr_inv_mem_first',
        profileId: 'prf_inv_mem_first',
        organizationId: 'org_admin_1'
      })
      expect(invited.role).toBe('user')

      const admin = await bootstrapOperatorAccount(state, operator, TEST_FAST_PASSWORD_POLICY)
      expect(admin.role).toBe('admin')
      expect(admin.accountId).not.toBe(invited.accountId)

      const adminAgain = await bootstrapOperatorAccount(
        state,
        { ...operator, email: 'other-mem@example.com' },
        TEST_FAST_PASSWORD_POLICY
      )
      expect(adminAgain.accountId).toBe(admin.accountId)
      expect(adminAgain.role).toBe('admin')
    } finally {
      await state.close()
    }
  })
})
