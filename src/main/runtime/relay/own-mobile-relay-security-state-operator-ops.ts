import type {
  SecurityStateRedactedAccessSession,
  SecurityStateRedactedRelayGrant,
  SecurityStateRedactedDeviceCredential,
  SecurityStateOperatorSession,
  SecurityStateIssueOperatorSessionInput,
  SecurityStateIssuedOperatorSession
} from './own-mobile-relay-security-state'
import type { InternalOperatorSessionRecord } from './own-mobile-relay-security-state-types'
import { isSessionValid, isGrantValid } from './own-mobile-relay-security-state-validation'
import { sha256Base64Url } from './own-mobile-relay-security-state-device-cleanup'
import { assertOpen, type MemoryStoreContext } from './own-mobile-relay-security-state-memory-ops'
import { randomBytes } from 'node:crypto'

export function listAccessSessionsMemory(
  ctx: MemoryStoreContext,
  now: number
): SecurityStateRedactedAccessSession[] {
  assertOpen(ctx)
  const result: SecurityStateRedactedAccessSession[] = []
  for (const session of ctx.sessionsById.values()) {
    if (isSessionValid(session, ctx.account, now)) {
      result.push({
        sessionId: session.sessionId,
        accountId: session.accountId,
        expiresAt: session.expiresAt,
        createdAt: session.createdAt,
        identity: session.identity
      })
    }
  }
  return result
}

export function listRelayGrantsMemory(
  ctx: MemoryStoreContext,
  now: number
): SecurityStateRedactedRelayGrant[] {
  assertOpen(ctx)
  const result: SecurityStateRedactedRelayGrant[] = []
  for (const grant of ctx.grantsById.values()) {
    const parent = ctx.sessionsById.get(grant.parentSessionId)
    const keyExpiryDisabled = ctx.hostKeyExpiry.get(grant.relayHostId) ?? true
    if (isGrantValid(grant, parent, ctx.account, now, keyExpiryDisabled)) {
      result.push({
        grantId: grant.grantId,
        accountId: grant.accountId,
        parentSessionId: grant.parentSessionId,
        relayHostId: grant.relayHostId,
        expiresAt: grant.expiresAt,
        createdAt: grant.createdAt,
        keyExpiryDisabled,
        identity: grant.identity
      })
    }
  }
  return result
}

export function listDeviceCredentialsMemory(
  ctx: MemoryStoreContext
): SecurityStateRedactedDeviceCredential[] {
  assertOpen(ctx)
  const result: SecurityStateRedactedDeviceCredential[] = []
  for (const dev of ctx.devicesByKey.values()) {
    result.push({
      relayHostId: dev.relayHostId,
      relayDeviceId: dev.relayDeviceId,
      lastInstallReqId: dev.lastInstallReqId,
      currentVersion: dev.currentVersion,
      resumeExpiresAt: dev.resumeExpiresAt,
      authorizationMode: dev.authorizationMode,
      ...(dev.graceExpiresAt !== undefined ? { graceExpiresAt: dev.graceExpiresAt } : {}),
      revoked: dev.revokedAt !== undefined,
      keyExpiryDisabled: dev.keyExpiryDisabled ?? true
    })
  }
  return result
}

export function issueOperatorSessionMemory(
  ctx: MemoryStoreContext,
  input: SecurityStateIssueOperatorSessionInput,
  now: number
): SecurityStateIssuedOperatorSession {
  assertOpen(ctx)
  if (!ctx.account) {
    throw new Error('account_not_initialized')
  }
  const sessionId = randomBytes(16).toString('base64url')
  const tokenHash = sha256Base64Url(input.rawToken)
  const expiresAt = now + input.ttlMs
  const session: InternalOperatorSessionRecord = {
    sessionId,
    accountId: ctx.account.accountId,
    tokenHash,
    authEpoch: ctx.account.authEpoch,
    expiresAt,
    createdAt: now
  }
  ctx.operatorSessionsById.set(sessionId, session)
  ctx.operatorSessionsByTokenHash.set(tokenHash, sessionId)
  return {
    sessionId,
    accountId: session.accountId,
    authEpoch: session.authEpoch,
    expiresAt: session.expiresAt
  }
}

export function lookupOperatorSessionMemory(
  ctx: MemoryStoreContext,
  rawToken: string,
  now: number
): SecurityStateOperatorSession | null {
  assertOpen(ctx)
  const hash = sha256Base64Url(rawToken)
  const sessionId = ctx.operatorSessionsByTokenHash.get(hash)
  if (!sessionId) {
    return null
  }
  const session = ctx.operatorSessionsById.get(sessionId)
  if (
    !session ||
    session.revokedAt !== undefined ||
    session.expiresAt <= now ||
    !ctx.account ||
    session.authEpoch !== ctx.account.authEpoch
  ) {
    return null
  }
  return {
    sessionId: session.sessionId,
    accountId: session.accountId,
    authEpoch: session.authEpoch,
    expiresAt: session.expiresAt,
    createdAt: session.createdAt
  }
}

export function revokeOperatorSessionMemory(
  ctx: MemoryStoreContext,
  rawToken: string,
  now: number
): boolean {
  assertOpen(ctx)
  const hash = sha256Base64Url(rawToken)
  const sessionId = ctx.operatorSessionsByTokenHash.get(hash)
  if (!sessionId) {
    return false
  }
  const session = ctx.operatorSessionsById.get(sessionId)
  if (!session) {
    return false
  }
  if (session.revokedAt === undefined) {
    session.revokedAt = now
    ctx.operatorSessionsByTokenHash.delete(hash)
  }
  return true
}
