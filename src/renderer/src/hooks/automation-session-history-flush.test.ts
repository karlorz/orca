import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CLAUDE_SESSION_HISTORY_FLUSH_MS,
  waitForAutomationSessionHistoryFlush
} from './automation-session-history-flush'

const agentStatusByPaneKey: Record<string, { agentType?: string }> = {}

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({ agentStatusByPaneKey })
  }
}))

describe('automation session history flush', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    for (const key of Object.keys(agentStatusByPaneKey)) {
      delete agentStatusByPaneKey[key]
    }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not delay Grok or unknown agents', async () => {
    agentStatusByPaneKey['pane'] = { agentType: 'grok' }
    const pending = waitForAutomationSessionHistoryFlush('pane')
    await expect(pending).resolves.toBeUndefined()
  })

  it('waits after Claude done so jsonl can flush before closeTab', async () => {
    agentStatusByPaneKey['pane'] = { agentType: 'claude' }
    let settled = false
    const pending = waitForAutomationSessionHistoryFlush('pane').then(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(CLAUDE_SESSION_HISTORY_FLUSH_MS - 1)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await pending
    expect(settled).toBe(true)
  })
})
