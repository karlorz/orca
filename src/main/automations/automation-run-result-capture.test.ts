import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AutomationRun } from '../../shared/automations-types'
import type { AutomationAgentResultStatus } from './automation-run-agent-result-source'
import { AutomationRunResultCapture } from './automation-run-result-capture'

function makeRun(): AutomationRun {
  return {
    id: 'run',
    automationId: 'automation',
    title: 'Review',
    scheduledFor: 1,
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
    dispatchedAt: Date.now() - 90,
    createdAt: Date.now() - 200
  }
}
function makeRow(
  overrides: Partial<AutomationAgentResultStatus> = {}
): AutomationAgentResultStatus {
  return {
    paneKey: 'tab:leaf',
    terminalHandle: 'handle',
    connectionId: null,
    worktreeId: 'workspace',
    state: 'done',
    agentType: 'grok',
    prompt: 'Review',
    receivedAt: Date.now(),
    stateStartedAt: Date.now() - 40,
    turnStartedAt: Date.now() - 50,
    launchToken: 'launch',
    providerPromptId: 'prompt-1',
    providerSession: { key: 'session_id', id: 'session-1' },
    mainAgent: { state: 'done', outcome: 'failure', stateStartedAt: Date.now() - 40 },
    ...overrides
  }
}
function setup(initialRow: Partial<AutomationAgentResultStatus> = {}) {
  let run: AutomationRun | null = makeRun()
  let row = makeRow(initialRow)
  const listeners = new Set<(value: AutomationAgentResultStatus) => void>()
  const clearListeners = new Set<(pane: string) => void>()
  const write = vi.fn(
    async (
      current: AutomationRun,
      outputSnapshot: NonNullable<AutomationRun['outputSnapshot']>
    ) => {
      run = { ...current, outputSnapshot }
      return run
    }
  )
  const capture = new AutomationRunResultCapture({
    source: {
      readPane: () => [row],
      subscribe: (callback) => {
        listeners.add(callback)
        return () => {
          listeners.delete(callback)
        }
      },
      subscribeClear: (callback) => {
        clearListeners.add(callback)
        return () => {
          clearListeners.delete(callback)
        }
      }
    },
    readRun: () => run,
    writeSnapshot: write
  })
  capture.track(run)
  return {
    capture,
    write,
    listeners,
    clearListeners,
    read: () => run,
    finish: (status: 'completed' | 'dispatch_failed' = 'dispatch_failed') => {
      if (!run) {
        throw new Error('run missing')
      }
      run = { ...run, status, error: status === 'dispatch_failed' ? 'Provider failed' : null }
      return run
    },
    prune: () => {
      run = null
    },
    publish: (overrides: Partial<AutomationAgentResultStatus>) => {
      row = { ...row, ...overrides }
      for (const listener of listeners) {
        listener(row)
      }
    },
    clear: () => {
      for (const listener of clearListeners) {
        listener('tab:leaf')
      }
    }
  }
}

describe('same-turn late automation output', () => {
  beforeEach(() => vi.restoreAllMocks())

  it.each(['completed', 'dispatch_failed'] as const)(
    'updates late prose without changing %s',
    async (status) => {
      const state = setup()
      await state.capture.refresh(state.finish(status))
      state.publish({ lastAssistantMessage: 'Final report' })
      await vi.waitFor(() => expect(state.write).toHaveBeenCalledOnce())
      expect(state.read()).toMatchObject({
        status,
        error: status === 'dispatch_failed' ? 'Provider failed' : null,
        outputSnapshot: { content: 'Final report' }
      })
      state.capture.dispose()
    }
  )

  it('captures prose discovered before final persistence', async () => {
    const state = setup()
    state.publish({ lastAssistantMessage: 'Final report' })
    expect(state.write).not.toHaveBeenCalled()
    await state.capture.refresh(state.finish())
    expect(state.write).toHaveBeenCalledOnce()
    state.capture.dispose()
  })

  it('does not mistake missing identity fields for a new owner', async () => {
    const state = setup()
    state.finish()
    state.publish({ providerSession: undefined, lastAssistantMessage: 'Unattributed' })
    await Promise.resolve()
    expect(state.write).not.toHaveBeenCalled()
    state.publish({
      providerSession: { key: 'session_id', id: 'session-1' },
      lastAssistantMessage: 'Final report'
    })
    await vi.waitFor(() => expect(state.write).toHaveBeenCalledOnce())
    state.capture.dispose()
  })

  it('does not rewrite an unchanged snapshot on repeated status events', async () => {
    const state = setup()
    state.finish()
    state.publish({ lastAssistantMessage: 'Final report' })
    await vi.waitFor(() => expect(state.write).toHaveBeenCalledOnce())
    state.publish({ lastAssistantMessage: 'Final report' })
    await Promise.resolve()
    expect(state.write).toHaveBeenCalledOnce()
    state.capture.dispose()
  })

  it.each([
    { turnStartedAt: Date.now() + 1 },
    { providerPromptId: 'prompt-2' },
    { launchToken: 'other-launch' },
    { terminalHandle: 'other-handle' },
    { providerSession: { key: 'session_id', id: 'session-2' } },
    { connectionId: 'remote-host' },
    { state: 'working', mainAgent: { state: 'working', stateStartedAt: Date.now() } }
  ] satisfies Partial<AutomationAgentResultStatus>[])(
    'rejects replaced turn/incarnation %#',
    async (change) => {
      const state = setup()
      state.finish()
      state.publish(change)
      state.publish({ lastAssistantMessage: 'Newer turn prose' })
      await Promise.resolve()
      expect(state.write).not.toHaveBeenCalled()
      state.capture.dispose()
    }
  )

  it.each([
    { lastAssistantMessageIsToolOutput: true },
    { restoredUnconfirmed: true },
    { providerSessionOnly: true },
    { turnStartedAt: undefined },
    { evidenceObservedAt: 1 },
    { isReplay: true },
    { worktreeId: 'other-workspace' },
    { agentType: 'unknown' }
  ] satisfies Partial<AutomationAgentResultStatus>[])(
    'does not use tool/stale/unattributed output %#',
    async (change) => {
      const state = setup()
      state.finish()
      state.publish({ ...change, lastAssistantMessage: 'Not a final result' })
      await Promise.resolve()
      expect(state.write).not.toHaveBeenCalled()
      state.capture.dispose()
    }
  )

  it('drops a pruned run without writing a late result', async () => {
    const state = setup()
    state.prune()
    state.publish({ lastAssistantMessage: 'Late report' })
    await Promise.resolve()
    expect(state.write).not.toHaveBeenCalled()
    state.capture.dispose()
  })

  it('keeps final prose delivered at the original completed turn session boundary', async () => {
    const state = setup()
    state.finish()
    state.publish({ sessionBoundary: true, lastAssistantMessage: 'Final refusal' })
    await vi.waitFor(() => expect(state.write).toHaveBeenCalledOnce())
    expect(state.read()).toMatchObject({ status: 'dispatch_failed', error: 'Provider failed' })
    state.capture.dispose()
  })

  it('never binds a run from a session-boundary row alone', async () => {
    const state = setup({ sessionBoundary: true })
    await state.capture.refresh(state.finish())
    state.publish({ lastAssistantMessage: 'Unbound boundary output' })
    await Promise.resolve()
    expect(state.write).not.toHaveBeenCalled()
    state.capture.dispose()
  })

  it('does not return an older verdict after snapshot flush races a correction', async () => {
    const state = setup()
    const run = state.finish('completed')
    state.publish({ lastAssistantMessage: 'Final report' })
    await vi.waitFor(() => expect(state.write).toHaveBeenCalledOnce())
    state.write.mockImplementationOnce(async (current, outputSnapshot) => {
      const written = { ...current, outputSnapshot }
      state.finish('dispatch_failed')
      return written
    })
    state.listeners.clear()
    state.publish({ lastAssistantMessage: 'Updated final report' })
    const current = await state.capture.refresh(run)
    expect(current.status).toBe('dispatch_failed')
    expect(current.error).toBe('Provider failed')
    state.capture.dispose()
  })

  it('does not attach a newer run on the same pane to its predecessor', async () => {
    const state = setup()
    state.finish()
    state.capture.track({ ...makeRun(), id: 'new-run', startedAt: Date.now() })
    state.publish({
      turnStartedAt: Date.now() + 1,
      providerPromptId: 'new-prompt',
      lastAssistantMessage: 'New run report'
    })
    await Promise.resolve()
    expect(state.write).not.toHaveBeenCalled()
    state.capture.dispose()
  })

  it('bounds abandoned result correlations', async () => {
    const state = setup()
    state.finish()
    for (let index = 0; index < 128; index += 1) {
      state.capture.track({
        ...makeRun(),
        id: `other-run-${index}`,
        terminalPaneKey: `other-pane-${index}`
      })
    }
    state.publish({ lastAssistantMessage: 'Late report' })
    await Promise.resolve()
    expect(state.write).not.toHaveBeenCalled()
    state.capture.dispose()
  })

  it('does not keep a subscription after pane clear or service disposal', async () => {
    const state = setup()
    state.finish()
    state.clear()
    state.publish({ lastAssistantMessage: 'Late report' })
    await Promise.resolve()
    expect(state.write).not.toHaveBeenCalled()
    state.capture.dispose()
    state.capture.dispose()
    expect(state.listeners.size).toBe(0)
    expect(state.clearListeners.size).toBe(0)
  })
})
