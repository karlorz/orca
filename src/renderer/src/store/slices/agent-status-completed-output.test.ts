import { describe, expect, it } from 'vitest'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import { resolveAgentStatusLiveEntryStateHistory } from './agent-status-live-entry-state-history'

describe('completed assistant output provenance', () => {
  it.each([true, false])(
    'retains assistant prose but not tool output (tool=%s)',
    (isToolOutput) => {
      const entry: AgentStatusEntry = {
        state: 'done',
        paneKey: 'tab:leaf',
        prompt: 'Review',
        updatedAt: 10,
        stateStartedAt: 10,
        stateHistory: [],
        lastAssistantMessage: 'Latest message',
        lastAssistantMessageIsToolOutput: isToolOutput,
        lastCompletedAssistantMessage: 'Previous turn'
      }
      const result = resolveAgentStatusLiveEntryStateHistory(entry, { state: 'working' }, 20)
      expect(result.lastCompletedAssistantMessage).toBe(isToolOutput ? undefined : 'Latest message')
    }
  )
})
