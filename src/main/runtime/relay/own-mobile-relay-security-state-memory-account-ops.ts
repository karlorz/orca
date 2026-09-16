import { randomBytes } from 'node:crypto'
import type { PasswordRecord } from './own-mobile-relay-password'
import type { InternalAccountRecord } from './own-mobile-relay-security-state-types'
import type {
  SecurityStateAccountBootstrapInput,
  SecurityStateAccountIdentity
} from './own-mobile-relay-security-state'
import {
  assertOpen,
  toPublicAccount,
  type MemoryStoreContext
} from './own-mobile-relay-security-state-memory-ops'

export function bootstrapAccountMemory(
  ctx: MemoryStoreContext,
  input: SecurityStateAccountBootstrapInput,
  now: number
): SecurityStateAccountIdentity {
  assertOpen(ctx)
  for (const a of ctx.accountsById.values()) {
    if (a.role === 'admin') {
      throw new Error('account_already_initialized')
    }
  }
  const emailNorm = input.email.toLowerCase()
  for (const acc of ctx.accountsById.values()) {
    if (
      acc.email.toLowerCase() === emailNorm ||
      acc.userId === input.userId ||
      acc.profileId === input.profileId
    ) {
      throw new Error('account_already_initialized')
    }
  }
  const accountId = randomBytes(16).toString('base64url')
  const newAccount: InternalAccountRecord = {
    accountId,
    email: emailNorm,
    userId: input.userId,
    profileId: input.profileId,
    organizationId: input.organizationId,
    role: 'admin',
    status: 'active',
    verifierVersion: 1,
    authEpoch: 1,
    passwordRecord: input.passwordRecord,
    createdAt: now,
    updatedAt: now
  }
  ctx.accountsById.set(accountId, newAccount)
  ctx.account = newAccount
  return toPublicAccount(newAccount)
}

export function inviteAccountMemory(
  ctx: MemoryStoreContext,
  input: { email: string; userId: string; profileId: string; organizationId: string },
  now: number
): SecurityStateAccountIdentity {
  assertOpen(ctx)
  const emailNorm = input.email.toLowerCase()
  for (const acc of ctx.accountsById.values()) {
    if (acc.email.toLowerCase() === emailNorm) {
      throw new Error('email_already_exists')
    }
    if (acc.userId === input.userId) {
      throw new Error('user_id_already_exists')
    }
    if (acc.profileId === input.profileId) {
      throw new Error('profile_id_already_exists')
    }
  }
  const accountId = randomBytes(16).toString('base64url')
  const record: InternalAccountRecord = {
    accountId,
    email: emailNorm,
    userId: input.userId,
    profileId: input.profileId,
    organizationId: input.organizationId,
    role: 'user',
    status: 'invited',
    verifierVersion: 1,
    authEpoch: 1,
    passwordRecord: null,
    createdAt: now,
    updatedAt: now
  }
  ctx.accountsById.set(accountId, record)
  return toPublicAccount(record)
}

export function activateInvitedAccountMemory(
  ctx: MemoryStoreContext,
  accountId: string,
  record: PasswordRecord,
  now: number
): 'ok' | 'conflict' {
  assertOpen(ctx)
  const acc = ctx.accountsById.get(accountId)
  if (!acc) {
    return 'conflict'
  }
  if (acc.status === 'active') {
    return 'conflict'
  }
  if (acc.status !== 'invited') {
    return 'conflict'
  }
  acc.status = 'active'
  acc.passwordRecord = record
  acc.updatedAt = now
  if (ctx.account && ctx.account.accountId === acc.accountId) {
    ctx.account = acc
  }
  return 'ok'
}

export function replacePasswordVerifierMemory(
  ctx: MemoryStoreContext,
  accountId: string,
  input: { expectedVerifierVersion: number; newPasswordRecord: PasswordRecord },
  now: number
):
  | { ok: true; account: SecurityStateAccountIdentity }
  | { ok: false; error: 'version_mismatch' | 'not_found' | 'not_active' } {
  assertOpen(ctx)
  const acc = ctx.accountsById.get(accountId)
  if (!acc) {
    return { ok: false, error: 'not_found' }
  }
  if (acc.status !== 'active') {
    return { ok: false, error: 'not_active' }
  }
  if (acc.verifierVersion !== input.expectedVerifierVersion) {
    return { ok: false, error: 'version_mismatch' }
  }
  acc.verifierVersion += 1
  acc.authEpoch += 1
  acc.passwordRecord = input.newPasswordRecord
  acc.updatedAt = now
  if (ctx.account && ctx.account.accountId === acc.accountId) {
    ctx.account = acc
  }
  return { ok: true, account: toPublicAccount(acc) }
}

export function upgradePasswordVerifierMemory(
  ctx: MemoryStoreContext,
  accountId: string,
  input: { expectedVerifierVersion: number; newPasswordRecord: PasswordRecord },
  now: number
):
  | { ok: true; account: SecurityStateAccountIdentity }
  | { ok: false; error: 'version_mismatch' | 'not_found' | 'not_active' } {
  assertOpen(ctx)
  const acc = ctx.accountsById.get(accountId)
  if (!acc) {
    return { ok: false, error: 'not_found' }
  }
  if (acc.status !== 'active') {
    return { ok: false, error: 'not_active' }
  }
  if (acc.verifierVersion !== input.expectedVerifierVersion) {
    return { ok: false, error: 'version_mismatch' }
  }
  acc.verifierVersion += 1
  acc.passwordRecord = input.newPasswordRecord
  acc.updatedAt = now
  if (ctx.account && ctx.account.accountId === acc.accountId) {
    ctx.account = acc
  }
  return { ok: true, account: toPublicAccount(acc) }
}

export function disableAccountMemory(
  ctx: MemoryStoreContext,
  accountId: string,
  now: number
): 'ok' | 'last_admin' {
  assertOpen(ctx)
  const acc = ctx.accountsById.get(accountId)
  if (!acc || acc.status !== 'active') {
    return 'ok'
  }
  if (acc.role === 'admin') {
    let adminCount = 0
    for (const a of ctx.accountsById.values()) {
      if (a.role === 'admin' && a.status !== 'disabled') {
        adminCount += 1
      }
    }
    if (adminCount <= 1) {
      return 'last_admin'
    }
  }
  acc.status = 'disabled'
  acc.authEpoch += 1
  acc.updatedAt = now
  if (ctx.account && ctx.account.accountId === acc.accountId) {
    ctx.account = acc
  }
  return 'ok'
}

export function listAccountsMemory(ctx: MemoryStoreContext): SecurityStateAccountIdentity[] {
  assertOpen(ctx)
  const list = Array.from(ctx.accountsById.values())
  list.sort((a, b) => a.createdAt - b.createdAt)
  return list.map(toPublicAccount)
}
