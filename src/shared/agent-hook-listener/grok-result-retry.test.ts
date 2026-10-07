import { describe, expect, it } from 'vitest'
import type { AgentHookEventPayload } from './listener-event'
import { recoverGrokHookResult } from './grok-result-retry'

const current: AgentHookEventPayload = {
  paneKey: 'tab:leaf',
  connectionId: null,
  providerPromptId: 'prompt-1',
  hookEventName: 'SessionEnd',
  payload: {
    agentType: 'grok',
    state: 'done',
    prompt: 'review',
    sessionBoundary: true,
    lastAssistantMessage: 'Missing file',
    lastAssistantMessageIsToolOutput: true,
    mainAgent: { state: 'done', outcome: 'failure', stateStartedAt: 123 }
  }
}

describe('Grok result-only recovery', () => {
  it('replaces tool text without replaying the old completion verdict', () => {
    const result = recoverGrokHookResult(
      { payload: { hookEventName: 'Stop', lastAssistantMessage: 'Final refusal' } },
      { ...current, hookEventName: 'Stop' },
      current
    )
    expect(result).toMatchObject({
      hookEventName: 'SessionEnd',
      providerPromptId: 'prompt-1',
      payload: {
        sessionBoundary: true,
        lastAssistantMessage: 'Final refusal',
        lastAssistantMessageIsToolOutput: false,
        mainAgent: current.payload.mainAgent
      }
    })
    expect(current.payload.lastAssistantMessage).toBe('Missing file')
  })
  it('rejects malformed and non-assistant result bodies', () => {
    expect(recoverGrokHookResult(null, current, current)).toBeNull()
    expect(recoverGrokHookResult({ payload: '{broken' }, current, current)).toBeNull()
    expect(
      recoverGrokHookResult(
        { payload: { toolOutput: 'tool only', toolName: 'read_file' } },
        { ...current, hookEventName: 'PostToolUse' },
        current
      )
    ).toBeNull()
  })
})
