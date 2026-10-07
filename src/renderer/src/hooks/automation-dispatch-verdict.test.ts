import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentStatusEntry } from '../../../shared/agent-status-types'
import { createAutomationDispatchCompletion } from './automation-dispatch-completion'

const testState = vi.hoisted(() => ({
  agentStatusByPaneKey: {} as Record<string, AgentStatusEntry>,
  subscriber: undefined as (() => void) | undefined
}))
const flush = vi.hoisted(() => vi.fn<() => Promise<void>>())
vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => testState,
    subscribe: (subscriber: () => void) => {
      testState.subscriber = subscriber
      return () => {}
    }
  }
}))
vi.mock('./automation-session-history-flush', () => ({
  waitForAutomationSessionHistoryFlush: flush
}))

const persist = vi.fn()
const release = vi.fn()
const finalize = vi.fn(() => true)
const paneKey = 'tab:leaf'
function createCompletion() {
  return createAutomationDispatchCompletion({
    run: { id: 'run', terminalPaneKey: paneKey } as never,
    worktree: { id: 'workspace' } as never,
    precheckResult: null,
    markDispatchResult: persist,
    releaseTerminalOwnership: release,
    finalizeTerminalOwnership: finalize
  })
}
function failedEntry(): AgentStatusEntry {
  return {
    state: 'done',
    paneKey,
    prompt: 'review',
    updatedAt: 20,
    stateStartedAt: 20,
    mainAgent: { state: 'done', outcome: 'failure', stateStartedAt: 20 },
    stateHistory: [],
    lastAssistantMessage: 'Provider refused this request.'
  }
}

describe('automation dispatch recorded verdict', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    testState.agentStatusByPaneKey = {}
    testState.subscriber = undefined
    flush.mockResolvedValue(undefined)
    persist.mockResolvedValue(undefined)
  })

  it('preserves a failed callback received before dispatch persistence', async () => {
    const completion = createCompletion()
    completion.handleAgentDone(failedEntry())
    await completion.settlePendingAfterDispatch()
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({ status: 'dispatch_failed' }))
    expect(release).toHaveBeenCalledOnce()
    expect(finalize).not.toHaveBeenCalled()
  })

  it.each(['current', 'history'] as const)('honors a failed %s store entry', async (source) => {
    const completion = createCompletion()
    await completion.settlePendingAfterDispatch()
    const entry = failedEntry()
    if (source === 'history') {
      entry.stateHistory = [
        { state: 'working', prompt: 'review', startedAt: 10 },
        {
          state: 'done',
          prompt: 'review',
          startedAt: 20,
          mainAgent: entry.mainAgent
        }
      ]
      entry.state = 'working'
      entry.mainAgent = { state: 'working', stateStartedAt: 21 }
      entry.lastCompletedAssistantMessage = entry.lastAssistantMessage
    }
    testState.agentStatusByPaneKey[paneKey] = entry
    completion.observeAgentStatus(paneKey, 10)
    await vi.waitFor(() => expect(release).toHaveBeenCalledOnce())
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({ status: 'dispatch_failed' }))
    expect(finalize).not.toHaveBeenCalled()
  })

  it('does not overwrite failure when a provider identity arrives during flush', async () => {
    flush.mockImplementation(async () => {
      testState.agentStatusByPaneKey[paneKey] = {
        ...failedEntry(),
        providerSession: { id: 'late-session', key: 'session_id' }
      }
    })
    const completion = createCompletion()
    await completion.settlePendingAfterDispatch()
    completion.handleAgentDone(failedEntry())
    await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(2))
    expect(persist).toHaveBeenLastCalledWith({
      runId: 'run',
      status: 'dispatch_failed',
      providerSessionId: 'late-session'
    })
    expect(finalize).not.toHaveBeenCalled()
  })

  it('prefers terminal diagnostics to intermediate tool output', async () => {
    const completion = createCompletion()
    await completion.settlePendingAfterDispatch()
    completion.appendOutput('Final provider refusal')
    completion.captureAssistantMessage('Planning the review')
    completion.captureAssistantMessage('Missing file', true)
    completion.handleAgentDone(failedEntry())
    await vi.waitFor(() => expect(release).toHaveBeenCalledOnce())
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({
        outputSnapshot: expect.objectContaining({ content: 'Final provider refusal' })
      })
    )
  })

  it('does not retain earlier prose when batched completion has no assistant result', async () => {
    const completion = createCompletion()
    await completion.settlePendingAfterDispatch()
    completion.captureAssistantMessage('Previous turn prose')
    completion.appendOutput('Final provider refusal')
    const entry = failedEntry()
    entry.stateHistory = [
      { state: 'done', prompt: 'review', startedAt: 20, mainAgent: entry.mainAgent }
    ]
    entry.state = 'working'
    entry.lastCompletedAssistantMessage = undefined
    testState.agentStatusByPaneKey[paneKey] = entry
    completion.observeAgentStatus(paneKey, 10)
    await vi.waitFor(() => expect(release).toHaveBeenCalledOnce())
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({
        outputSnapshot: expect.objectContaining({ content: 'Final provider refusal' })
      })
    )
  })
})
