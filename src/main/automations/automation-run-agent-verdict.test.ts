import { describe, expect, it, vi } from 'vitest'
import type { AutomationRun } from '../../shared/automations-types'
import type { AgentStatusIpcPayload } from '../../shared/agent-status-types'
import { readAutomationRunAgentCompletion } from './automation-run-agent-verdict'
import { createRuntimeAutomationRunTerminalObserver } from './runtime-terminal-run-observer'

function makeRun(): AutomationRun {
  return {
    id: 'run',
    automationId: 'automation',
    title: 'Review',
    scheduledFor: 10,
    status: 'dispatched',
    trigger: 'scheduled',
    workspaceId: 'workspace',
    sessionKind: 'terminal',
    chatSessionId: null,
    terminalSessionId: 'tab',
    terminalPaneKey: 'tab:leaf',
    terminalPtyId: 'pty',
    outputSnapshot: null,
    precheckResult: null,
    usage: null,
    error: null,
    startedAt: Date.now() - 100,
    dispatchedAt: Date.now() - 50,
    createdAt: Date.now() - 200
  }
}
function makeRow(overrides: Partial<AgentStatusIpcPayload> = {}): AgentStatusIpcPayload {
  return {
    paneKey: 'tab:leaf',
    terminalHandle: 'handle',
    connectionId: null,
    worktreeId: 'workspace',
    state: 'done',
    agentType: 'grok',
    prompt: 'Review',
    receivedAt: Date.now(),
    stateStartedAt: Date.now(),
    mainAgent: { state: 'done', outcome: 'failure', stateStartedAt: Date.now() },
    ...overrides
  }
}

describe('owning host automation verdict', () => {
  it('reads a recorded failure from the canonical pane row', () => {
    expect(readAutomationRunAgentCompletion(makeRun(), 'handle', [makeRow()])).toEqual({
      status: 'dispatch_failed',
      error: 'Automation agent reported a failed turn.'
    })
  })

  it.each([
    { restoredUnconfirmed: true },
    { providerSessionOnly: true },
    { sessionBoundary: true, mainAgent: { state: 'done', stateStartedAt: Date.now() } },
    { terminalHandle: 'other-handle' },
    { worktreeId: 'other-workspace' },
    { paneKey: 'other-pane', terminalHandle: undefined },
    { evidenceObservedAt: 1 },
    { mainAgent: { state: 'done', outcome: 'failure', stateStartedAt: 1 } },
    { mainAgent: { state: 'working', stateStartedAt: Date.now() } }
  ] satisfies Partial<AgentStatusIpcPayload>[])(
    'does not spend unrelated or stale evidence: %j',
    (overrides) => {
      expect(
        readAutomationRunAgentCompletion(makeRun(), 'handle', [makeRow(overrides)])
      ).toBeUndefined()
    }
  )

  it('does not accept a different provider session', () => {
    const run = { ...makeRun(), providerSessionId: 'current-session' }
    expect(
      readAutomationRunAgentCompletion(run, 'handle', [
        makeRow({ providerSession: { id: 'other-session', key: 'session_id' } })
      ])
    ).toBeUndefined()
  })

  it('retains a recorded same-turn failure through the shutdown boundary', () => {
    expect(
      readAutomationRunAgentCompletion(makeRun(), 'handle', [makeRow({ sessionBoundary: true })])
        ?.status
    ).toBe('dispatch_failed')
  })

  it('makes satisfied terminal idle fail when the owning host records failure', async () => {
    const waitForTerminal = vi
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ satisfied: true })
    const readStatus = vi.fn(() => [makeRow()])
    const observer = createRuntimeAutomationRunTerminalObserver(
      {
        getTerminalHandleForPaneKey: () => 'handle',
        waitForTerminal,
        readTerminal: async () => ({ tail: ['Final provider refusal'] })
      },
      readStatus
    )
    const result = await observer.observeCompletion('handle', {
      signal: new AbortController().signal,
      run: makeRun()
    })
    expect(readStatus).toHaveBeenCalledWith('tab:leaf')
    expect(result.status).toBe('dispatch_failed')
    expect(result.outputSnapshot?.content).toBe('Final provider refusal')
  })
})
