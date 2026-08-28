import type {
  SecurityStateAccessSession,
  SecurityStateRelayGrant
} from './own-mobile-relay-security-state'
import {
  isSessionValid,
  toPublicAccessSession,
  isGrantValid,
  toPublicRelayGrant
} from './own-mobile-relay-security-state-validation'
import { sha256Base64Url } from './own-mobile-relay-security-state-device-cleanup'
import { assertOpen, type MemoryStoreContext } from './own-mobile-relay-security-state-memory-ops'

export function lookupAccessSessionByTokenMemory(
  ctx: MemoryStoreContext,
  rawAccessToken: string,
  now: number
): SecurityStateAccessSession | null {
  assertOpen(ctx)
  const hash = sha256Base64Url(rawAccessToken)
  const sessionId = ctx.sessionsByAccessHash.get(hash)
  if (!sessionId) {
    return null
  }
  const session = ctx.sessionsById.get(sessionId)
  if (!session || !isSessionValid(session, ctx.account, now)) {
    return null
  }
  return toPublicAccessSession(session)
}

export function revokeAccessSessionByIdMemory(
  ctx: MemoryStoreContext,
  sessionId: string,
  now: number
): boolean {
  assertOpen(ctx)
  const session = ctx.sessionsById.get(sessionId)
  if (!session) {
    return false
  }
  if (session.revokedAt === undefined) {
    session.revokedAt = now
    ctx.sessionsByAccessHash.delete(session.accessTokenHash)
  }
  return true
}

export function revokeAccessSessionByTokenMemory(
  ctx: MemoryStoreContext,
  rawAccessToken: string,
  now: number
): boolean {
  assertOpen(ctx)
  const hash = sha256Base64Url(rawAccessToken)
  const sessionId = ctx.sessionsByAccessHash.get(hash)
  if (!sessionId) {
    return false
  }
  const session = ctx.sessionsById.get(sessionId)
  if (!session) {
    return false
  }
  if (session.revokedAt === undefined) {
    session.revokedAt = now
    ctx.sessionsByAccessHash.delete(hash)
  }
  return true
}

export function validateRelayGrantByTokenMemory(
  ctx: MemoryStoreContext,
  rawRelayToken: string,
  now: number
): SecurityStateRelayGrant | null {
  assertOpen(ctx)
  const hash = sha256Base64Url(rawRelayToken)
  const grantId = ctx.grantsByTokenHash.get(hash)
  if (!grantId) {
    return null
  }
  const grant = ctx.grantsById.get(grantId)
  if (!grant) {
    return null
  }
  const parent = ctx.sessionsById.get(grant.parentSessionId)
  if (!isGrantValid(grant, parent, ctx.account, now)) {
    return null
  }
  return toPublicRelayGrant(grant)
}

export function validateRelayGrantByIdMemory(
  ctx: MemoryStoreContext,
  grantId: string,
  relayHostId: string | undefined,
  now: number
): SecurityStateRelayGrant | null {
  assertOpen(ctx)
  const grant = ctx.grantsById.get(grantId)
  if (!grant || (relayHostId && grant.relayHostId !== relayHostId)) {
    return null
  }
  const parent = ctx.sessionsById.get(grant.parentSessionId)
  if (!isGrantValid(grant, parent, ctx.account, now)) {
    return null
  }
  return toPublicRelayGrant(grant)
}

export function revokeRelayGrantByIdMemory(
  ctx: MemoryStoreContext,
  grantId: string,
  now: number
): boolean {
  assertOpen(ctx)
  const grant = ctx.grantsById.get(grantId)
  if (!grant) {
    return false
  }
  if (grant.revokedAt === undefined) {
    grant.revokedAt = now
    ctx.grantsByTokenHash.delete(grant.relayTokenHash)
  }
  return true
}
