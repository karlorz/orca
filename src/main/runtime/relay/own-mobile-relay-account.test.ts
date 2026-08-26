import { describe, it, expect } from 'vitest'
import { createOwnMobileRelaySecurityStateMemory } from './own-mobile-relay-security-state-memory'
import { bootstrapOperatorAccount } from './own-mobile-relay-account'
import { TEST_FAST_PASSWORD_POLICY } from './own-mobile-relay-password'
import type { OwnMobileRelayOperatorConfig } from './own-mobile-relay-types'

describe('own-mobile-relay-account bootstrap', () => {
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
})
