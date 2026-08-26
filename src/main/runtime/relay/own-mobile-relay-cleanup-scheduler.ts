import type { OwnMobileRelaySecurityState } from './own-mobile-relay-security-state'

export const RELAY_CLEANUP_INTERVAL_MS = 5 * 60 * 1000
export const RELAY_CLEANUP_BATCH_LIMIT = 256

export type OwnMobileRelayCleanupScheduler = {
  start: () => void
  stop: () => void
}

export function createOwnMobileRelayCleanupScheduler(options: {
  securityState: OwnMobileRelaySecurityState
  intervalMs?: number
  batchLimit?: number
}): OwnMobileRelayCleanupScheduler {
  const intervalMs = options.intervalMs ?? RELAY_CLEANUP_INTERVAL_MS
  const batchLimit = options.batchLimit ?? RELAY_CLEANUP_BATCH_LIMIT
  let timer: NodeJS.Timeout | null = null
  let stopped = false

  async function runCleanup(): Promise<void> {
    if (stopped) {
      return
    }
    try {
      await options.securityState.cleanupExpired({
        maxBatchSize: batchLimit
      })
    } catch {
      process.stderr.write('[own-mobile-relay] cleanup-failure\n')
    }
  }

  return {
    start: () => {
      if (stopped || timer) {
        return
      }
      void runCleanup()
      timer = setInterval(() => {
        void runCleanup()
      }, intervalMs)
      timer.unref?.()
    },
    stop: () => {
      stopped = true
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    }
  }
}
