import type { DatabaseSync } from 'node:sqlite'
import type { PasswordRecord } from './own-mobile-relay-password'
import type {
  SecurityStateAccountBootstrapInput,
  SecurityStateAccountIdentity
} from './own-mobile-relay-security-state'
import {
  executeBootstrapAccountSqlite,
  executeGetAccountSqlite,
  executeGetAccountPasswordRecordSqlite,
  executeReplacePasswordVerifierSqlite,
  executeUpgradePasswordVerifierSqlite
} from './own-mobile-relay-security-state-sqlite-account-ops'
import {
  executeInviteAccountSqlite,
  executeActivateInvitedAccountSqlite,
  executeDisableAccountSqlite,
  executeHasAdminAccountSqlite,
  executeGetAdminAccountSqlite,
  executeListAccountsSqlite
} from './own-mobile-relay-security-state-sqlite-admin-ops'

export type SqliteAccountFacetContext = {
  db: DatabaseSync
  assertOpen: () => void
}

export function createSqliteAccountFacet(ctx: SqliteAccountFacetContext) {
  return {
    getAccount: async (selector?: {
      email?: string
      accountId?: string
      role?: 'admin' | 'user'
    }) => {
      ctx.assertOpen()
      return selector?.role === 'admin'
        ? executeGetAdminAccountSqlite(ctx.db, selector?.email)
        : executeGetAccountSqlite(ctx.db, selector)
    },
    hasAdminAccount: async () => {
      ctx.assertOpen()
      return executeHasAdminAccountSqlite(ctx.db)
    },
    bootstrapAccount: async (input: SecurityStateAccountBootstrapInput, now = Date.now()) => {
      ctx.assertOpen()
      return executeBootstrapAccountSqlite(ctx.db, input, now)
    },
    getAccountPasswordRecord: async (accountId?: string) => {
      ctx.assertOpen()
      return executeGetAccountPasswordRecordSqlite(ctx.db, accountId)
    },
    inviteAccount: async (
      input: { email: string; userId: string; profileId: string; organizationId: string },
      now = Date.now()
    ) => {
      ctx.assertOpen()
      return executeInviteAccountSqlite(ctx.db, input, now)
    },
    activateInvitedAccount: async (accountId: string, record: PasswordRecord, now = Date.now()) => {
      ctx.assertOpen()
      return executeActivateInvitedAccountSqlite(ctx.db, accountId, record, now)
    },
    replacePasswordVerifier: async (
      accountId: string,
      input: { expectedVerifierVersion: number; newPasswordRecord: PasswordRecord },
      now = Date.now()
    ) => {
      ctx.assertOpen()
      return executeReplacePasswordVerifierSqlite(ctx.db, accountId, input, now)
    },
    upgradePasswordVerifier: async (
      accountId: string,
      input: { expectedVerifierVersion: number; newPasswordRecord: PasswordRecord },
      now = Date.now()
    ) => {
      ctx.assertOpen()
      return executeUpgradePasswordVerifierSqlite(ctx.db, accountId, input, now)
    },
    disableAccount: async (accountId: string, now = Date.now()) => {
      ctx.assertOpen()
      return executeDisableAccountSqlite(ctx.db, accountId, now)
    },
    listAccounts: async (): Promise<SecurityStateAccountIdentity[]> => {
      ctx.assertOpen()
      return executeListAccountsSqlite(ctx.db)
    }
  }
}
