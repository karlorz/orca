import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HeadlessAutomationDispatcher } from '../automations/headless-dispatch'
import { buildProfileStateCutoverFixture } from '../persistence/profile-state-cutover-fixture'

const mocks = vi.hoisted(() => {
  const runtime = {
    launchAgentTerminal: vi.fn(),
    createManagedWorktree: vi.fn(),
    showManagedWorktree: vi.fn(),
    setAutomationService: vi.fn(),
    notifyAutomationsChanged: vi.fn()
  }
  return {
    runtime,
    observer: { resolveRunTerminal: vi.fn(), observeCompletion: vi.fn() },
    service: vi.fn(function (
      _store: unknown,
      _options: { headlessDispatcher?: HeadlessAutomationDispatcher; terminalObserver: unknown }
    ) {
      return { start: vi.fn(), stop: vi.fn() }
    }),
    state: { store: {}, runtime, claudeUsage: {}, codexUsage: {}, isServeMode: true }
  }
})

vi.mock('../automations/service', () => ({ AutomationService: mocks.service }))
vi.mock('../automations/runtime-terminal-run-observer', () => ({
  createRuntimeAutomationRunTerminalObserver: () => mocks.observer
}))
vi.mock('./main-process-state', () => ({ mainProcessState: mocks.state }))

import { initializeMainProcessAutomations } from './main-process-automations'

describe('automation startup completion ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.state.isServeMode = true
    mocks.runtime.launchAgentTerminal.mockResolvedValue({
      handle: 'terminal-handle',
      tabId: 'tab-id',
      paneKey: 'tab-id:leaf-id',
      ptyId: 'pty-id',
      worktreeId: 'worktree-id'
    })
    mocks.runtime.showManagedWorktree.mockResolvedValue({ displayName: 'Workspace' })
    mocks.runtime.createManagedWorktree.mockResolvedValue({
      worktree: { id: 'worktree-id', displayName: 'Workspace' },
      startupTerminal: {
        handle: 'terminal-handle',
        tabId: 'tab-id',
        paneKey: 'tab-id:leaf-id',
        ptyId: 'pty-id'
      }
    })
  })

  it.each(['existing', 'new_per_run'] as const)(
    'leaves %s launches to the guarded observer instead of a raw idle promise',
    async (workspaceMode) => {
      initializeMainProcessAutomations()
      const options = mocks.service.mock.calls[0]![1]
      expect(options.terminalObserver).toMatchObject({
        observeCompletion: mocks.observer.observeCompletion
      })
      expect(options.headlessDispatcher).toBeDefined()
      const fixture = buildProfileStateCutoverFixture('/fixture')
      const automation = { ...fixture.automations[0]!, workspaceMode }
      const launch = await options.headlessDispatcher!({
        automation,
        run: fixture.automationRuns[0]!,
        target: { ok: true, cwd: '/fixture', repo: fixture.repos[0]! }
      })
      expect(launch).toMatchObject({
        workspaceId: 'worktree-id',
        terminalSessionId: 'tab-id',
        terminalPaneKey: 'tab-id:leaf-id',
        terminalPtyId: 'pty-id'
      })
      expect(launch).not.toHaveProperty('completion')
    }
  )

  it('keeps desktop renderer dispatch separate from the serve-mode dispatcher', () => {
    mocks.state.isServeMode = false
    initializeMainProcessAutomations()
    expect(mocks.service.mock.calls[0]![1].headlessDispatcher).toBeUndefined()
    expect(mocks.service.mock.calls[0]![1].terminalObserver).toMatchObject({
      observeCompletion: mocks.observer.observeCompletion
    })
  })
})
