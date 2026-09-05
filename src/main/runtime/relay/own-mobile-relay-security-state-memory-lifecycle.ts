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
  const keepSessionIds = new Set<string>()
  if (ctx.account) {
    for (const record of ctx.refreshTokensByHash.values()) {
      if (
        record.revokedAt === undefined &&
        (record.expiresAt === null || record.expiresAt > now) &&
        record.authEpoch === ctx.account.authEpoch
      ) {
        keepSessionIds.add(record.sessionId)
      }
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
  ctx.account = null
}
