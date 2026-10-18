import type { SecurityStateCleanupResult } from './own-mobile-relay-security-state'
import type { MemoryStoreContext } from './own-mobile-relay-security-state-memory-ops'
import { assertOpen } from './own-mobile-relay-security-state-memory-ops'
import { cleanupExpiredRecords } from './own-mobile-relay-security-state-device-cleanup'

export function cleanupExpiredMemory(
  ctx: MemoryStoreContext,
  options?: { maxBatchSize?: number; now?: number }
): SecurityStateCleanupResult {
  assertOpen(ctx)
  const now = options?.now ?? Date.now()
  const maxBatch = options?.maxBatchSize ?? 1000

  // Revoke/remove stale or expired in-memory refresh tokens
  for (const [hash, record] of Array.from(ctx.refreshTokensByHash.entries())) {
    const acc = record.accountId ? ctx.accountsById.get(record.accountId) : ctx.account
    const sess = ctx.sessionsById.get(record.sessionId)
    const isStale =
      record.revokedAt !== undefined ||
      (record.expiresAt !== null && record.expiresAt <= now) ||
      !acc ||
      acc.status !== 'active' ||
      record.authEpoch !== acc.authEpoch ||
      !sess ||
      sess.authEpoch !== acc.authEpoch

    if (isStale) {
      ctx.refreshTokensByHash.delete(hash)
      const set = ctx.refreshHashesBySessionId.get(record.sessionId)
      if (set) {
        set.delete(hash)
        if (set.size === 0) {
          ctx.refreshHashesBySessionId.delete(record.sessionId)
        }
      }
    }
  }

  const keepSessionIds = new Set<string>()
  for (const record of ctx.refreshTokensByHash.values()) {
    const acc = record.accountId ? ctx.accountsById.get(record.accountId) : ctx.account
    if (
      record.revokedAt === undefined &&
      (record.expiresAt === null || record.expiresAt > now) &&
      acc &&
      acc.status === 'active' &&
      record.authEpoch === acc.authEpoch
    ) {
      keepSessionIds.add(record.sessionId)
    }
  }
  return cleanupExpiredRecords(
    {
      byId: ctx.sessionsById,
      byAccess: ctx.sessionsByAccessHash
    },
    { byId: ctx.grantsById, byToken: ctx.grantsByTokenHash },
    ctx.devicesByKey,
    ctx.account,
    maxBatch,
    now,
    keepSessionIds
  )
}

export function closeMemoryStore(ctx: MemoryStoreContext): void {
  ctx.isClosed = true
  ctx.sessionsById.clear()
  ctx.sessionsByAccessHash.clear()
  ctx.grantsById.clear()
  ctx.grantsByTokenHash.clear()
  ctx.devicesByKey.clear()
  ctx.operatorSessionsById.clear()
  ctx.operatorSessionsByTokenHash.clear()
  ctx.refreshTokensByHash.clear()
  ctx.refreshHashesBySessionId.clear()
  ctx.account = null
}
