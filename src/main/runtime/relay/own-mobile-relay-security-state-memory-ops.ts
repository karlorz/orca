import { randomBytes } from 'node:crypto'
import type { PasswordRecord } from './own-mobile-relay-password'
import type {
  InternalAccountRecord,
  InternalDeviceRecord,
  InternalGrantRecord,
  InternalSessionRecord
} from './own-mobile-relay-security-state-types'
import type {
  SecurityStateAccountBootstrapInput,
  SecurityStateAccountIdentity,
  SecurityStateIssueAccessSessionInput,
  SecurityStateIssuedAccessSession,
  SecurityStateIssueRelayGrantInput,
  SecurityStateIssuedRelayGrant
} from './own-mobile-relay-security-state'
import { isSessionValid } from './own-mobile-relay-security-state-validation'
import { sha256Base64Url } from './own-mobile-relay-security-state-device-cleanup'

export type MemoryStoreContext = {
  isClosed: boolean
  account: InternalAccountRecord | null
  sessionsById: Map<string, InternalSessionRecord>
  sessionsByAccessHash: Map<string, string>
  sessionsByRefreshHash: Map<string, string>
  grantsById: Map<string, InternalGrantRecord>
  grantsByTokenHash: Map<string, string>
  devicesByKey: Map<string, InternalDeviceRecord>
}

export function assertOpen(ctx: MemoryStoreContext): void {
  if (ctx.isClosed) {
    throw new Error('Security state adapter is closed')
  }
}

export function toPublicAccount(acc: InternalAccountRecord): SecurityStateAccountIdentity {
  return {
    accountId: acc.accountId,
    email: acc.email,
    userId: acc.userId,
    profileId: acc.profileId,
    organizationId: acc.organizationId,
    verifierVersion: acc.verifierVersion,
    authEpoch: acc.authEpoch,
    createdAt: acc.createdAt,
    updatedAt: acc.updatedAt
  }
}

export function bootstrapAccountMemory(
  ctx: MemoryStoreContext,
  input: SecurityStateAccountBootstrapInput,
  now: number
): SecurityStateAccountIdentity {
  assertOpen(ctx)
  if (ctx.account) {
    throw new Error('account_already_initialized')
  }
  const accountId = randomBytes(16).toString('base64url')
  ctx.account = {
    accountId,
    email: input.email,
    userId: input.userId,
    profileId: input.profileId,
    organizationId: input.organizationId,
    verifierVersion: 1,
    authEpoch: 1,
    passwordRecord: input.passwordRecord,
    createdAt: now,
    updatedAt: now
  }
  return toPublicAccount(ctx.account)
}

export function replacePasswordVerifierMemory(
  ctx: MemoryStoreContext,
  input: { expectedVerifierVersion: number; newPasswordRecord: PasswordRecord },
  now: number
):
  | { ok: true; account: SecurityStateAccountIdentity }
  | { ok: false; error: 'version_mismatch' | 'not_found' } {
  assertOpen(ctx)
  if (!ctx.account) {
    return { ok: false, error: 'not_found' }
  }
  if (ctx.account.verifierVersion !== input.expectedVerifierVersion) {
    return { ok: false, error: 'version_mismatch' }
  }
  ctx.account.verifierVersion += 1
  ctx.account.authEpoch += 1
  ctx.account.passwordRecord = input.newPasswordRecord
  ctx.account.updatedAt = now
  return { ok: true, account: toPublicAccount(ctx.account) }
}

export function issueAccessSessionMemory(
  ctx: MemoryStoreContext,
  input: SecurityStateIssueAccessSessionInput,
  now: number
): SecurityStateIssuedAccessSession {
  assertOpen(ctx)
  if (!ctx.account) {
    throw new Error('account_not_initialized')
  }
  const sessionId = randomBytes(16).toString('base64url')
  const accessTokenHash = sha256Base64Url(input.rawAccessToken)
  const refreshTokenHash = sha256Base64Url(input.rawRefreshToken)
  const expiresAt = now + input.ttlMs
  const session: InternalSessionRecord = {
    sessionId,
    accountId: ctx.account.accountId,
    authEpoch: ctx.account.authEpoch,
    accessTokenHash,
    refreshTokenHash,
    expiresAt,
    createdAt: now,
    identity: input.identity
  }
  ctx.sessionsById.set(sessionId, session)
  ctx.sessionsByAccessHash.set(accessTokenHash, sessionId)
  ctx.sessionsByRefreshHash.set(refreshTokenHash, sessionId)
  return {
    sessionId,
    accountId: session.accountId,
    authEpoch: session.authEpoch,
    expiresAt: session.expiresAt,
    identity: session.identity
  }
}

export function rotateAccessSessionMemory(
  ctx: MemoryStoreContext,
  input: {
    rawRefreshToken: string
    newRawAccessToken: string
    newRawRefreshToken: string
    ttlMs: number
  },
  now: number
): SecurityStateIssuedAccessSession | null {
  assertOpen(ctx)
  const oldHash = sha256Base64Url(input.rawRefreshToken)
  const sessionId = ctx.sessionsByRefreshHash.get(oldHash)
  if (!sessionId) {
    return null
  }
  const session = ctx.sessionsById.get(sessionId)
  if (!session || !isSessionValid(session, ctx.account, now)) {
    return null
  }
  ctx.sessionsByAccessHash.delete(session.accessTokenHash)
  ctx.sessionsByRefreshHash.delete(session.refreshTokenHash)
  const newAccessHash = sha256Base64Url(input.newRawAccessToken)
  const newRefreshHash = sha256Base64Url(input.newRawRefreshToken)
  session.accessTokenHash = newAccessHash
  session.refreshTokenHash = newRefreshHash
  session.expiresAt = now + input.ttlMs
  ctx.sessionsByAccessHash.set(newAccessHash, sessionId)
  ctx.sessionsByRefreshHash.set(newRefreshHash, sessionId)
  return {
    sessionId,
    accountId: session.accountId,
    authEpoch: session.authEpoch,
    expiresAt: session.expiresAt,
    identity: session.identity
  }
}

export function issueRelayGrantMemory(
  ctx: MemoryStoreContext,
  input: SecurityStateIssueRelayGrantInput,
  now: number
): SecurityStateIssuedRelayGrant | null {
  assertOpen(ctx)
  if (!ctx.account) {
    return null
  }
  const parent = ctx.sessionsById.get(input.parentSessionId)
  if (!parent || !isSessionValid(parent, ctx.account, now)) {
    return null
  }
  const grantId = randomBytes(16).toString('base64url')
  const relayTokenHash = sha256Base64Url(input.rawRelayToken)
  const expiresAt = now + input.ttlMs
  const grant: InternalGrantRecord = {
    grantId,
    accountId: ctx.account.accountId,
    parentSessionId: input.parentSessionId,
    relayTokenHash,
    relayHostId: input.relayHostId,
    hostPublicKeyB64: input.hostPublicKeyB64,
    authEpoch: ctx.account.authEpoch,
    expiresAt,
    createdAt: now,
    identity: input.identity
  }
  ctx.grantsById.set(grantId, grant)
  ctx.grantsByTokenHash.set(relayTokenHash, grantId)
  return {
    grantId,
    relayHostId: grant.relayHostId,
    hostPublicKeyB64: grant.hostPublicKeyB64,
    expiresAt: grant.expiresAt,
    identity: grant.identity
  }
}
