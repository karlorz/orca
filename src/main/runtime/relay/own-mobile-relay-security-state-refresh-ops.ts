import type {
  SecurityStateIssueRefreshTokenInput,
  SecurityStateLookupRefreshTokenResult,
  SecurityStateRotateRefreshTokenInput,
  SecurityStateIssuedAccessSession
} from './own-mobile-relay-security-state'
import type { InternalRefreshTokenRecord } from './own-mobile-relay-security-state-types'
import { isSessionValid } from './own-mobile-relay-security-state-validation'
import { sha256Base64Url } from './own-mobile-relay-security-state-device-cleanup'
import { assertOpen, type MemoryStoreContext } from './own-mobile-relay-security-state-memory-ops'
import { randomBytes } from 'node:crypto'

export function isRefreshTokenValid(
  record: InternalRefreshTokenRecord,
  accountAuthEpoch: number,
  now: number
): boolean {
  if (record.revokedAt !== undefined) {
    return false
  }
  if (record.expiresAt !== null && record.expiresAt <= now) {
    return false
  }
  if (record.authEpoch !== accountAuthEpoch) {
    return false
  }
  return true
}

export function issueRefreshTokenMemory(
  ctx: MemoryStoreContext,
  input: SecurityStateIssueRefreshTokenInput,
  now: number
): void {
  assertOpen(ctx)
  if (!ctx.account) {
    throw new Error('account_not_initialized')
  }
  const session = ctx.sessionsById.get(input.sessionId)
  if (!session || !isSessionValid(session, ctx.account, now)) {
    throw new Error('invalid_session')
  }

  const tokenHash = sha256Base64Url(input.rawRefreshToken)
  const expiresAt = input.ttlMs !== null ? now + input.ttlMs : null

  const record: InternalRefreshTokenRecord = {
    tokenHash,
    sessionId: input.sessionId,
    accountId: ctx.account.accountId,
    authEpoch: ctx.account.authEpoch,
    expiresAt,
    createdAt: now
  }

  ctx.refreshTokensByHash.set(tokenHash, record)
  let set = ctx.refreshHashesBySessionId.get(input.sessionId)
  if (!set) {
    set = new Set()
    ctx.refreshHashesBySessionId.set(input.sessionId, set)
  }
  set.add(tokenHash)
}

export function lookupRefreshTokenMemory(
  ctx: MemoryStoreContext,
  rawRefreshToken: string,
  now: number
): SecurityStateLookupRefreshTokenResult | null {
  assertOpen(ctx)
  if (!ctx.account) {
    return null
  }
  const tokenHash = sha256Base64Url(rawRefreshToken)
  const record = ctx.refreshTokensByHash.get(tokenHash)
  if (!record || !isRefreshTokenValid(record, ctx.account.authEpoch, now)) {
    return null
  }
  const session = ctx.sessionsById.get(record.sessionId)
  if (!session || !isSessionValid(session, ctx.account, now)) {
    return null
  }
  return {
    sessionId: record.sessionId,
    cloudProfileId: session.identity.cloudProfileId,
    expiresAt: record.expiresAt
  }
}

export function rotateRefreshTokenMemory(
  ctx: MemoryStoreContext,
  input: SecurityStateRotateRefreshTokenInput,
  now: number
): SecurityStateIssuedAccessSession | null {
  assertOpen(ctx)
  if (!ctx.account) {
    return null
  }

  const oldTokenHash = sha256Base64Url(input.oldRawRefreshToken)
  const oldRefreshRecord = ctx.refreshTokensByHash.get(oldTokenHash)
  if (!oldRefreshRecord || !isRefreshTokenValid(oldRefreshRecord, ctx.account.authEpoch, now)) {
    return null
  }

  const oldSession = ctx.sessionsById.get(oldRefreshRecord.sessionId)
  if (!oldSession || !isSessionValid(oldSession, ctx.account, now)) {
    return null
  }

  // Revoke old refresh token
  oldRefreshRecord.revokedAt = now
  ctx.refreshTokensByHash.delete(oldTokenHash)

  // Revoke old session
  oldSession.revokedAt = now
  ctx.sessionsByAccessHash.delete(oldSession.accessTokenHash)

  // Create new session
  const newSessionId = randomBytes(16).toString('base64url')
  const newAccessTokenHash = sha256Base64Url(input.newRawAccessToken)
  const newExpiresAt = now + input.accessTtlMs
  const newSession = {
    sessionId: newSessionId,
    accountId: ctx.account.accountId,
    authEpoch: ctx.account.authEpoch,
    accessTokenHash: newAccessTokenHash,
    expiresAt: newExpiresAt,
    createdAt: now,
    identity: oldSession.identity
  }
  ctx.sessionsById.set(newSessionId, newSession)
  ctx.sessionsByAccessHash.set(newAccessTokenHash, newSessionId)

  // Create new refresh token
  const newTokenHash = sha256Base64Url(input.newRawRefreshToken)
  const newRefreshExpiresAt = input.refreshTtlMs !== null ? now + input.refreshTtlMs : null
  const newRefreshRecord: InternalRefreshTokenRecord = {
    tokenHash: newTokenHash,
    sessionId: newSessionId,
    accountId: ctx.account.accountId,
    authEpoch: ctx.account.authEpoch,
    expiresAt: newRefreshExpiresAt,
    createdAt: now
  }
  ctx.refreshTokensByHash.set(newTokenHash, newRefreshRecord)
  const set = new Set<string>([newTokenHash])
  ctx.refreshHashesBySessionId.set(newSessionId, set)

  return {
    sessionId: newSessionId,
    accountId: newSession.accountId,
    authEpoch: newSession.authEpoch,
    expiresAt: newSession.expiresAt,
    identity: newSession.identity
  }
}

export function revokeRefreshTokensForSessionMemory(
  ctx: MemoryStoreContext,
  sessionId: string,
  now: number
): void {
  assertOpen(ctx)
  const hashes = ctx.refreshHashesBySessionId.get(sessionId)
  if (hashes) {
    for (const hash of hashes) {
      const rec = ctx.refreshTokensByHash.get(hash)
      if (rec) {
        rec.revokedAt = now
        ctx.refreshTokensByHash.delete(hash)
      }
    }
    ctx.refreshHashesBySessionId.delete(sessionId)
  }
}

export function isHostKeyExpiryDisabledMemory(
  ctx: MemoryStoreContext,
  relayHostId: string
): boolean {
  assertOpen(ctx)
  // Default is true (key expiry disabled)
  return ctx.hostKeyExpiry.get(relayHostId) ?? true
}

export function setHostKeyExpiryDisabledMemory(
  ctx: MemoryStoreContext,
  relayHostId: string,
  disabled: boolean
): void {
  assertOpen(ctx)
  ctx.hostKeyExpiry.set(relayHostId, disabled)
  if (!disabled) {
    // If enabling key expiry (disabled=false), fail closed: revoke refresh tokens for that host's parent sessions
    // Find all active grants for this host
    for (const grant of ctx.grantsById.values()) {
      if (grant.relayHostId === relayHostId && grant.revokedAt === undefined) {
        revokeRefreshTokensForSessionMemory(ctx, grant.parentSessionId, Date.now())
      }
    }
  }
}

export function isDeviceKeyExpiryDisabledMemory(
  ctx: MemoryStoreContext,
  relayHostId: string,
  relayDeviceId: string
): boolean {
  assertOpen(ctx)
  const key = `${relayHostId}:${relayDeviceId}`
  const dev = ctx.devicesByKey.get(key)
  if (!dev) {
    return true
  }
  return dev.keyExpiryDisabled ?? true
}

export function setDeviceKeyExpiryDisabledMemory(
  ctx: MemoryStoreContext,
  relayHostId: string,
  relayDeviceId: string,
  disabled: boolean
): void {
  assertOpen(ctx)
  const key = `${relayHostId}:${relayDeviceId}`
  const dev = ctx.devicesByKey.get(key)
  if (dev) {
    dev.keyExpiryDisabled = disabled
  }
}
