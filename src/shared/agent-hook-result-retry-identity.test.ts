import { describe, expect, it } from 'vitest'
import type { AgentHookEventPayload } from './agent-hook-listener/listener-event'
import { agentHookResultRetryMatchesTurn } from './agent-hook-result-retry-identity'

const original: AgentHookEventPayload & { turnStartedAt?: number } = {
  paneKey: 'tab:leaf',
  tabId: 'tab',
  worktreeId: 'workspace',
  connectionId: null,
  providerPromptId: 'prompt-1',
  providerSession: { key: 'session_id', id: 'session-1' },
  launchToken: 'launch',
  terminalHandle: 'handle',
  turnStartedAt: 1,
  payload: {
    agentType: 'grok',
    state: 'done',
    prompt: 'review',
    mainAgent: { state: 'done', outcome: 'failure', stateStartedAt: 1 }
  }
}

describe('same-turn result retry identity', () => {
  it('accepts a proven same-turn restatement and session boundary', () => {
    expect(
      agentHookResultRetryMatchesTurn(original, {
        ...original,
        payload: { ...original.payload, sessionBoundary: true }
      })
    ).toBe(true)
    expect(agentHookResultRetryMatchesTurn(original, original)).toBe(true)
  })
  it.each([
    { providerPromptId: 'new' },
    { providerPromptId: undefined },
    { providerSession: { key: 'session_id' as const, id: 'new' } },
    { launchToken: 'new' },
    { terminalHandle: 'new' },
    { connectionId: 'ssh' },
    { turnStartedAt: 2 },
    { hostTurnRevision: 'new' },
    { isReplay: true },
    { restoredUnconfirmed: true as const },
    { providerSessionOnly: true },
    { agentPresence: { agent: 'grok', ended: true as const } },
    {
      agentPresence: {
        agent: 'grok',
        process: { pid: 123, platform: 'linux' as const, startTime: 'new' }
      }
    },
    { hookEventName: 'UserPromptSubmit' },
    {
      payload: { ...original.payload, mainAgent: { state: 'working' as const, stateStartedAt: 2 } }
    }
  ])('rejects replaced or unverifiable turn %#', (change) => {
    expect(agentHookResultRetryMatchesTurn(original, { ...original, ...change })).toBe(false)
  })
  it('requires exact row identity for an older provider without prompt identity', () => {
    const legacy = { ...original, providerPromptId: undefined }
    expect(agentHookResultRetryMatchesTurn(legacy, { ...legacy })).toBe(false)
    expect(agentHookResultRetryMatchesTurn(legacy, legacy)).toBe(true)
  })
})
