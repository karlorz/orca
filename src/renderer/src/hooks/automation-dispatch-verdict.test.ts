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

  it('does not close a failed turn when zero exit persistence wins the callback race', async () => {
    let finishPersistence: () => void = () => {}
    persist.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishPersistence = resolve
        })
    )
    const completion = createCompletion()
    await completion.settlePendingAfterDispatch()
    completion.handleExit(0)
    completion.captureAssistantMessage('Provider refused this request.')
    completion.handleAgentDone(failedEntry())
    finishPersistence()
    await vi.waitFor(() => expect(release).toHaveBeenCalledOnce())
    expect(persist).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: 'dispatch_failed',
        error: 'Automation agent reported a failed turn.',
        outputSnapshot: expect.objectContaining({ content: 'Provider refused this request.' })
      })
    )
    expect(finalize).not.toHaveBeenCalled()
  })

  it('does not let a pending done erase a proven nonzero exit', async () => {
    const completion = createCompletion()
    completion.handleAgentDone({ state: 'done' })
    completion.handleExit(9)
    await completion.settlePendingAfterDispatch()
    expect(persist).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: 'dispatch_failed',
        error: 'Automation process exited with code 9.'
      })
    )
    expect(finalize).not.toHaveBeenCalled()
  })

  it('honors a nonzero exit received while done persistence is still pending', async () => {
    let finishFlush: () => void = () => {}
    flush.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishFlush = resolve
        })
    )
    const completion = createCompletion()
    await completion.settlePendingAfterDispatch()
    completion.handleAgentDone({ state: 'done' })
    await vi.waitFor(() => expect(flush).toHaveBeenCalledOnce())
    completion.handleExit(9)
    finishFlush()
    await vi.waitFor(() => expect(release).toHaveBeenCalledOnce())
    expect(persist).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: 'dispatch_failed',
        error: 'Automation process exited with code 9.'
      })
    )
    expect(finalize).not.toHaveBeenCalled()
  })

  it('does not reinterpret contact loss during history flush as a failed exit', async () => {
    let finishFlush: () => void = () => {}
    flush.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishFlush = resolve
        })
    )
    const completion = createCompletion()
    await completion.settlePendingAfterDispatch()
    completion.handleAgentDone({ state: 'done' })
    await vi.waitFor(() => expect(flush).toHaveBeenCalledOnce())
    completion.handleExit(-1)
    finishFlush()
    await vi.waitFor(() => expect(finalize).toHaveBeenCalledOnce())
    expect(persist.mock.calls.some(([result]) => result.status === 'dispatch_failed')).toBe(false)
  })

  it('does not reopen a result for a failure callback after terminal finalization', async () => {
    const completion = createCompletion()
    await completion.settlePendingAfterDispatch()
    completion.handleExit(0)
    await vi.waitFor(() => expect(finalize).toHaveBeenCalledOnce())
    const writtenResults = persist.mock.calls.length
    completion.handleAgentDone(failedEntry())
    await Promise.resolve()
    expect(persist).toHaveBeenCalledTimes(writtenResults)
    expect(release).not.toHaveBeenCalled()
  })

  it('preserves the terminal if the corrective failure write is rejected', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    persist.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('storage unavailable'))
    const completion = createCompletion()
    await completion.settlePendingAfterDispatch()
    completion.handleExit(0)
    completion.handleAgentDone(failedEntry())
    await vi.waitFor(() => expect(release).toHaveBeenCalledOnce())
    expect(finalize).not.toHaveBeenCalled()
    errorLog.mockRestore()
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
      error: 'Automation agent reported a failed turn.',
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
