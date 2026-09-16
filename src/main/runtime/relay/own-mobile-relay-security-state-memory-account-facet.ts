import type { PasswordRecord } from './own-mobile-relay-password'
import type {
  SecurityStateAccountBootstrapInput,
  SecurityStateAccountIdentity
} from './own-mobile-relay-security-state'
import {
  assertOpen,
  toPublicAccount,
  type MemoryStoreContext
} from './own-mobile-relay-security-state-memory-ops'
import {
  bootstrapAccountMemory,
  inviteAccountMemory,
  activateInvitedAccountMemory,
  replacePasswordVerifierMemory,
  upgradePasswordVerifierMemory,
  disableAccountMemory
} from './own-mobile-relay-security-state-memory-account-ops'

export function createMemoryAccountFacet(ctx: MemoryStoreContext) {
  return {
    async getAccount(selector?: {
      email?: string
      accountId?: string
    }): Promise<SecurityStateAccountIdentity | null> {
      assertOpen(ctx)
      if (selector?.accountId) {
        const found = ctx.accountsById.get(selector.accountId)
        return found ? toPublicAccount(found) : null
      }
      if (selector?.email) {
        const lower = selector.email.toLowerCase()
        for (const a of ctx.accountsById.values()) {
          if (a.email.toLowerCase() === lower) {
            return toPublicAccount(a)
          }
        }
        return null
      }
      return ctx.account ? toPublicAccount(ctx.account) : null
    },

    async bootstrapAccount(
      input: SecurityStateAccountBootstrapInput,
      now = Date.now()
    ): Promise<SecurityStateAccountIdentity> {
      return bootstrapAccountMemory(ctx, input, now)
    },

    async getAccountPasswordRecord(accountId?: string): Promise<{
      accountId: string
      verifierVersion: number
      authEpoch: number
      passwordRecord: PasswordRecord
    } | null> {
      assertOpen(ctx)
      const target = accountId ? ctx.accountsById.get(accountId) : ctx.account
      if (!target || !target.passwordRecord) {
        return null
      }
      return {
        accountId: target.accountId,
        verifierVersion: target.verifierVersion,
        authEpoch: target.authEpoch,
        passwordRecord: target.passwordRecord
      }
    },

    async inviteAccount(
      input: { email: string; userId: string; profileId: string; organizationId: string },
      now = Date.now()
    ): Promise<SecurityStateAccountIdentity> {
      return inviteAccountMemory(ctx, input, now)
    },

    async activateInvitedAccount(
      accountId: string,
      record: PasswordRecord,
      now = Date.now()
    ): Promise<'ok' | 'conflict'> {
      return activateInvitedAccountMemory(ctx, accountId, record, now)
    },

    async replacePasswordVerifier(
      accountId: string,
      input: { expectedVerifierVersion: number; newPasswordRecord: PasswordRecord },
      now = Date.now()
    ) {
      return replacePasswordVerifierMemory(ctx, accountId, input, now)
    },

    async upgradePasswordVerifier(
      accountId: string,
      input: { expectedVerifierVersion: number; newPasswordRecord: PasswordRecord },
      now = Date.now()
    ) {
      return upgradePasswordVerifierMemory(ctx, accountId, input, now)
    },

    async disableAccount(accountId: string, now = Date.now()): Promise<'ok' | 'last_admin'> {
      return disableAccountMemory(ctx, accountId, now)
    }
  }
}
