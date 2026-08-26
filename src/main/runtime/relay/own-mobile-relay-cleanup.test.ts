import { describe, expect, it, vi } from 'vitest'
import {
  createOwnMobileRelayCleanupScheduler,
  RELAY_CLEANUP_BATCH_LIMIT,
  RELAY_CLEANUP_INTERVAL_MS
} from './own-mobile-relay-cleanup-scheduler'
import type { OwnMobileRelaySecurityState } from './own-mobile-relay-security-state'
import { listenOwnMobileRelay } from './own-mobile-relay-http'
import { TEST_OPERATOR } from './own-mobile-relay-test-auth'

describe('own-mobile-relay cleanup scheduler', () => {
  it('runs once immediately on start and periodically every five minutes with 256 batch limit', async () => {
    vi.useFakeTimers()
    try {
      const cleanupCalls: { maxBatchSize?: number; now?: number }[] = []
      const mockSecurityState: Partial<OwnMobileRelaySecurityState> = {
        cleanupExpired: vi.fn(async (options?: { maxBatchSize?: number; now?: number }) => {
          cleanupCalls.push(options ?? {})
          return {
            expiredSessionsDeleted: 1,
            expiredGrantsDeleted: 2,
            expiredDevicesDeleted: 3
          }
        })
      }

      const scheduler = createOwnMobileRelayCleanupScheduler({
        securityState: mockSecurityState as OwnMobileRelaySecurityState
      })

      scheduler.start()

      // Allow immediate initial cleanup promise to execute
      await vi.advanceTimersByTimeAsync(0)
      expect(mockSecurityState.cleanupExpired).toHaveBeenCalledTimes(1)
      expect(cleanupCalls[0]?.maxBatchSize).toBe(RELAY_CLEANUP_BATCH_LIMIT)
      expect(RELAY_CLEANUP_BATCH_LIMIT).toBe(256)
      expect(RELAY_CLEANUP_INTERVAL_MS).toBe(5 * 60 * 1000)

      // Advance by one interval (5 minutes)
      await vi.advanceTimersByTimeAsync(RELAY_CLEANUP_INTERVAL_MS)
      expect(mockSecurityState.cleanupExpired).toHaveBeenCalledTimes(2)
      expect(cleanupCalls[1]?.maxBatchSize).toBe(256)

      // Advance by another interval
      await vi.advanceTimersByTimeAsync(RELAY_CLEANUP_INTERVAL_MS)
      expect(mockSecurityState.cleanupExpired).toHaveBeenCalledTimes(3)

      // Stop scheduler: no more calls
      scheduler.stop()
      await vi.advanceTimersByTimeAsync(RELAY_CLEANUP_INTERVAL_MS * 2)
      expect(mockSecurityState.cleanupExpired).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('logs cleanup failure as a non-secret operation failure without throwing or crashing', async () => {
    vi.useFakeTimers()
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      const mockSecurityState: Partial<OwnMobileRelaySecurityState> = {
        cleanupExpired: vi.fn(async () => {
          throw new Error('database disk I/O error on sensitive_table_xyz with token secret123')
        })
      }

      const scheduler = createOwnMobileRelayCleanupScheduler({
        securityState: mockSecurityState as OwnMobileRelaySecurityState
      })

      scheduler.start()
      await vi.advanceTimersByTimeAsync(0)

      expect(mockSecurityState.cleanupExpired).toHaveBeenCalledTimes(1)
      expect(stderrSpy).toHaveBeenCalled()
      const loggedText = stderrSpy.mock.calls.map((call) => String(call[0])).join('\n')
      expect(loggedText).toContain('[own-mobile-relay] cleanup-failure')
      // Non-secret logging: must not leak error text with potential sensitive table/token details
      expect(loggedText).not.toContain('secret123')
      expect(loggedText).not.toContain('sensitive_table_xyz')

      scheduler.stop()
    } finally {
      stderrSpy.mockRestore()
      vi.useRealTimers()
    }
  })

  it('starts cleanup scheduler in listenOwnMobileRelay and stops on server close', async () => {
    let cleanupCount = 0
    const { createOwnMobileRelaySecurityStateMemory } =
      await import('./own-mobile-relay-security-state-memory')
    const baseState = createOwnMobileRelaySecurityStateMemory()
    const state: typeof baseState = {
      ...baseState,
      cleanupExpired: async (opts) => {
        cleanupCount++
        return baseState.cleanupExpired(opts)
      }
    }

    const server = await listenOwnMobileRelay({
      operator: TEST_OPERATOR,
      securityState: state,
      origin: 'http://127.0.0.1'
    })

    try {
      // Immediate cleanup ran on trustworthy startup
      await vi.waitFor(() => expect(cleanupCount).toBeGreaterThanOrEqual(1))
    } finally {
      await server.close()
    }

    const countAtClose = cleanupCount
    // Give event loop some ticks to make sure no post-close cleanup runs
    await new Promise((r) => setTimeout(r, 50))
    expect(cleanupCount).toBe(countAtClose)
  })
})
