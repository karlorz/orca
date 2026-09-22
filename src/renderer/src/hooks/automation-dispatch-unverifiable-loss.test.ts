import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AutomationDispatchResult } from '../../../shared/automations-types'

const storeState = {
  agentStatusByPaneKey: {} as Record<string, { providerSession?: { id?: string } }>,
  sleepingAgentSessionsByPaneKey: {} as Record<string, { providerSession?: { id?: string } }>
}

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => storeState,
    subscribe: vi.fn(() => () => {})
  }
}))

const markDispatchResult = vi.fn<(result: AutomationDispatchResult) => Promise<void>>()
const releaseTerminalOwnership = vi.fn()
const finalizeTerminalOwnership = vi.fn(() => false)

async function createCompletion(run: Record<string, unknown> = { id: 'run-1' }) {
  const { createAutomationDispatchCompletion } = await import('./automation-dispatch-completion')
  const completion = createAutomationDispatchCompletion({
    run: run as never,
    worktree: { id: 'wt-1', displayName: 'Automation worktree' } as never,
    precheckResult: null,
    markDispatchResult,
    releaseTerminalOwnership,
    finalizeTerminalOwnership
  })
  // The dispatch itself is already recorded before any exit can settle it.
  await completion.settlePendingAfterDispatch()
  markDispatchResult.mockClear()
  return completion
}

/**
 * Loss of contact is never evidence of process death
 * (docs/reference/ssh-execution-boundary.md). The exit sentinel these readers
 * receive is the same one the terminal panes already classify as unverifiable.
 */
describe('automation dispatch completion on an unverifiable loss', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    markDispatchResult.mockResolvedValue(undefined)
    finalizeTerminalOwnership.mockReset()
    finalizeTerminalOwnership.mockReturnValue(false)
    storeState.agentStatusByPaneKey = {}
    storeState.sleepingAgentSessionsByPaneKey = {}
  })

  it('records no result, so the run keeps its non-final dispatched status', async () => {
    // A -1 is a lost relay or a synthesized host-shutdown fanout. Reporting
    // "exited with code -1" asserts a finish nobody witnessed; on SSH the
    // automation is very likely still running.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const completion = await createCompletion()

    completion.handleExit(-1)
    await vi.waitFor(() => expect(releaseTerminalOwnership).toHaveBeenCalledOnce())

    expect(markDispatchResult).not.toHaveBeenCalled()
    // Closing a terminal whose process cannot be proven dead orphans live work.
    expect(finalizeTerminalOwnership).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('still completes and finalizes a genuinely exited process', async () => {
    const completion = await createCompletion()
    finalizeTerminalOwnership.mockReturnValue(true)

    completion.handleExit(0)
    await vi.waitFor(() => expect(finalizeTerminalOwnership).toHaveBeenCalledOnce())

    expect(markDispatchResult).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-1', status: 'completed', error: null })
    )
    expect(releaseTerminalOwnership).not.toHaveBeenCalled()
  })

  it('still reports a real automation failure as dispatch_failed', async () => {
    const completion = await createCompletion()

    completion.handleExit(9)
    await vi.waitFor(() => expect(releaseTerminalOwnership).toHaveBeenCalledOnce())

    expect(markDispatchResult).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-1',
        status: 'dispatch_failed',
        error: 'Automation process exited with code 9.'
      })
    )
    expect(finalizeTerminalOwnership).not.toHaveBeenCalled()
  })

  it('lets a later done still complete a run whose contact was lost', async () => {
    // The loss withheld a verdict rather than settling one, so positive
    // evidence arriving afterwards must still be able to close the run.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const completion = await createCompletion()

    completion.handleExit(-1)
    await vi.waitFor(() => expect(releaseTerminalOwnership).toHaveBeenCalledOnce())
    completion.handleAgentDone()

    await vi.waitFor(() =>
      expect(markDispatchResult).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'completed' })
      )
    )
    warnSpy.mockRestore()
  })

  it('persists a provider session captured while the run tab closes', async () => {
    const paneKey = 'agent-tab:7c6fb4e5-3bf1-4ff4-8259-03f7ae81c40d'
    finalizeTerminalOwnership.mockImplementation(() => {
      storeState.sleepingAgentSessionsByPaneKey[paneKey] = {
        providerSession: { id: '01a0c3d8-91ef-7222-ae04-0025960f4ea4' }
      }
      return true
    })
    const completion = await createCompletion({ id: 'run-1', terminalPaneKey: paneKey })

    completion.handleAgentDone()

    await vi.waitFor(() =>
      expect(markDispatchResult).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'completed',
          providerSessionId: '01a0c3d8-91ef-7222-ae04-0025960f4ea4'
        })
      )
    )
  })
})
