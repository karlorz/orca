import type {
  InternalAccountRecord,
  InternalGrantRecord,
  InternalSessionRecord
} from './own-mobile-relay-security-state-types'
import type {
  SecurityStateAccessSession,
  SecurityStateRelayGrant
} from './own-mobile-relay-security-state'

export function isSessionValid(
  session: InternalSessionRecord,
  account: InternalAccountRecord | null,
  now: number
): boolean {
  if (session.revokedAt !== undefined || session.expiresAt <= now) {
    return false
  }
  if (!account || session.authEpoch !== account.authEpoch) {
    return false
  }
  return true
}

export function toPublicAccessSession(session: InternalSessionRecord): SecurityStateAccessSession {
  return {
    sessionId: session.sessionId,
    accountId: session.accountId,
    authEpoch: session.authEpoch,
    expiresAt: session.expiresAt,
    createdAt: session.createdAt,
    identity: session.identity
  }
}

export function isGrantValid(
  grant: InternalGrantRecord,
  parent: InternalSessionRecord | undefined,
  account: InternalAccountRecord | null,
  now: number
): boolean {
  if (grant.revokedAt !== undefined || grant.expiresAt <= now) {
    return false
  }
  if (!account || grant.authEpoch !== account.authEpoch) {
    return false
  }
  if (!parent || !isSessionValid(parent, account, now)) {
    return false
  }
  return true
}

export function toPublicRelayGrant(grant: InternalGrantRecord): SecurityStateRelayGrant {
  return {
    grantId: grant.grantId,
    accountId: grant.accountId,
    parentSessionId: grant.parentSessionId,
    relayHostId: grant.relayHostId,
    hostPublicKeyB64: grant.hostPublicKeyB64,
    authEpoch: grant.authEpoch,
    expiresAt: grant.expiresAt,
    createdAt: grant.createdAt,
    identity: grant.identity
  }
}
