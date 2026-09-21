import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SleepingAgentSessionRecord } from '../../../../shared/agent-session-resume'
import type { AutomationRun } from '../../../../shared/automations-types'
import { singlePaneLayoutSnapshot } from '@/store/slices/terminal-helpers'
import { createAutomationRunWorkspaceAction } from './automation-run-workspace-action'
import type { AutomationsPageActionContext } from './automations-page-action-context'

const leafId = '11111111-1111-4111-8111-111111111111'
const paneKey = `tab-1:${leafId}`
const worktreeId = 'wt-downloads'

const mocks = vi.hoisted(() => ({
  activateAndRevealWorktree: vi.fn(() => true),
  toastMessage: vi.fn(),
  toastError: vi.fn(),
  setActiveTab: vi.fn(),
  setActiveTabType: vi.fn(),
  setTabLayout: vi.fn(),
  setTabCustomTitle: vi.fn(),
  createTab: vi.fn(() => ({ id: 'tab-1' })),
  setState: vi.fn(),
  captureSleepingAgentSessionsByWorktree: vi.fn(),
  agentStatusByPaneKey: {} as Record<string, { providerSession?: { key: string; id: string } }>,
  terminalLayoutsByTabId: {} as Record<string, ReturnType<typeof singlePaneLayoutSnapshot>>,
  ptyIdsByTabId: {} as Record<string, string[]>,
  tabsByWorktree: {} as Record<string, { id: string; worktreeId: string }[]>,
  sleepingAgentSessionsByPaneKey: {} as Record<string, SleepingAgentSessionRecord>
}))

vi.mock('@/lib/worktree-activation', () => ({
  activateAndRevealWorktree: mocks.activateAndRevealWorktree
}))

vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => mocks.toastError(...args),
    message: (...args: unknown[]) => mocks.toastMessage(...args)
  }
}))

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({
      setActiveTab: mocks.setActiveTab,
      setActiveTabType: mocks.setActiveTabType,
      setTabLayout: mocks.setTabLayout,
      setTabCustomTitle: mocks.setTabCustomTitle,
      createTab: mocks.createTab,
      captureSleepingAgentSessionsByWorktree: mocks.captureSleepingAgentSessionsByWorktree,
      agentStatusByPaneKey: mocks.agentStatusByPaneKey,
      terminalLayoutsByTabId: mocks.terminalLayoutsByTabId,
      ptyIdsByTabId: mocks.ptyIdsByTabId,
      tabsByWorktree: mocks.tabsByWorktree,
      sleepingAgentSessionsByPaneKey: mocks.sleepingAgentSessionsByPaneKey
    }),
    setState: (...args: unknown[]) => mocks.setState(...args)
  }
}))

function makeRun(overrides: Partial<AutomationRun> = {}): AutomationRun {
  return {
    id: 'run-2',
    automationId: 'automation-1',
    title: 'ping',
    scheduledFor: 1,
    status: 'completed',
    trigger: 'manual',
    workspaceId: worktreeId,
    workspaceDisplayName: 'Downloads',
    sessionKind: 'terminal',
    chatSessionId: null,
    terminalSessionId: 'tab-1',
    terminalPaneKey: paneKey,
    terminalPtyId: null,
    outputSnapshot: null,
    precheckResult: null,
    usage: null,
    error: null,
    startedAt: 1,
    dispatchedAt: 1,
    createdAt: 1,
    ...overrides
  }
}

function makeSleepingRecord(): SleepingAgentSessionRecord {
  return {
    paneKey,
    tabId: 'tab-1',
    worktreeId,
    agent: 'claude',
    providerSession: { key: 'session_id', id: 'sess-1' },
    prompt: 'ping',
    state: 'done',
    origin: 'worktree-sleep',
    capturedAt: 1,
    updatedAt: 1
  }
}

function openRun(run: AutomationRun = makeRun()): void {
  const action = createAutomationRunWorkspaceAction({
    store: {
      repoForRow: () => ({ id: 'repo-1' }),
      worktreeForRow: () => ({ id: worktreeId, displayName: 'Downloads' })
    },
    list: { selectedRow: { automation: { agentId: 'claude' } } }
  } as unknown as AutomationsPageActionContext)
  action(run)
}

describe('automation run workspace action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.activateAndRevealWorktree.mockReturnValue(true)
    mocks.createTab.mockReturnValue({ id: 'tab-1' })
    mocks.terminalLayoutsByTabId = {
      'tab-1': singlePaneLayoutSnapshot(leafId)
    }
    mocks.ptyIdsByTabId = { 'tab-1': [] }
    mocks.tabsByWorktree = {
      [worktreeId]: [{ id: 'tab-1', worktreeId }]
    }
    mocks.sleepingAgentSessionsByPaneKey = {
      [paneKey]: makeSleepingRecord()
    }
    mocks.agentStatusByPaneKey = {}
  })

  it('focuses a still-mounted pane after hibernation instead of launching --resume', () => {
    mocks.ptyIdsByTabId = {
      'tab-1': ['pty-reborn']
    }
    mocks.terminalLayoutsByTabId = {
      'tab-1': {
        ...singlePaneLayoutSnapshot(leafId),
        ptyIdsByLeafId: { [leafId]: 'pty-reborn' }
      }
    }

    openRun()

    expect(mocks.setActiveTab).toHaveBeenCalledWith('tab-1')
    expect(mocks.setActiveTabType).toHaveBeenCalledWith('terminal')
    expect(mocks.createTab).not.toHaveBeenCalled()
    expect(mocks.setState).not.toHaveBeenCalled()
    expect(mocks.toastMessage).not.toHaveBeenCalled()
  })

  it('remounts the original pane when the Claude tab was closed', () => {
    mocks.tabsByWorktree = { [worktreeId]: [] }
    const sleepingRecord = makeSleepingRecord()
    mocks.sleepingAgentSessionsByPaneKey = { [paneKey]: sleepingRecord }

    openRun()

    expect(mocks.activateAndRevealWorktree).toHaveBeenCalledWith(worktreeId)
    expect(mocks.createTab).toHaveBeenCalledWith(worktreeId, undefined, undefined, {
      id: 'tab-1',
      initialLeafId: leafId,
      launchAgent: 'claude',
      activate: true
    })
    expect(mocks.setTabLayout).not.toHaveBeenCalled()
    expect(mocks.createTab.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.activateAndRevealWorktree.mock.invocationCallOrder[0]
    )
    expect(mocks.setActiveTab).toHaveBeenLastCalledWith('tab-1')
    expect(mocks.toastMessage).not.toHaveBeenCalled()
  })

  it('does not steal another Claude session when the run pane key was cleared', () => {
    mocks.tabsByWorktree = { [worktreeId]: [] }
    mocks.sleepingAgentSessionsByPaneKey = { [paneKey]: makeSleepingRecord() }

    openRun(makeRun({ terminalPaneKey: null, terminalSessionId: null }))

    expect(mocks.createTab).not.toHaveBeenCalled()
    expect(mocks.toastMessage).toHaveBeenCalled()
  })

  it('remounts a closed tab from the run provider session when nothing was hibernated', () => {
    mocks.tabsByWorktree = { [worktreeId]: [] }
    mocks.sleepingAgentSessionsByPaneKey = {}

    openRun(makeRun({ terminalPtyId: 'pty-1', providerSessionId: 'sess-closed' }))

    expect(mocks.createTab).toHaveBeenCalledWith(worktreeId, undefined, undefined, {
      id: 'tab-1',
      initialLeafId: leafId,
      launchAgent: 'claude',
      activate: true
    })
    expect(mocks.setState).toHaveBeenCalled()
    expect(mocks.toastMessage).not.toHaveBeenCalled()
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('synthesizes Antigravity conversation_id metadata instead of session_id', () => {
    mocks.tabsByWorktree = { [worktreeId]: [] }
    mocks.sleepingAgentSessionsByPaneKey = {}
    const action = createAutomationRunWorkspaceAction({
      store: {
        repoForRow: () => ({ id: 'repo-1' }),
        worktreeForRow: () => ({ id: worktreeId, displayName: 'Downloads' })
      },
      list: { selectedRow: { automation: { agentId: 'antigravity' } } }
    } as unknown as AutomationsPageActionContext)

    action(makeRun({ terminalPtyId: 'pty-1', providerSessionId: 'agy-conv' }))

    expect(mocks.setState).toHaveBeenCalledWith(
      expect.objectContaining({
        sleepingAgentSessionsByPaneKey: expect.objectContaining({
          [paneKey]: expect.objectContaining({
            agent: 'antigravity',
            providerSession: { key: 'conversation_id', id: 'agy-conv' }
          })
        })
      })
    )
    expect(mocks.createTab).toHaveBeenCalledWith(
      worktreeId,
      undefined,
      undefined,
      expect.objectContaining({ launchAgent: 'antigravity' })
    )
  })

  it('does not synthesize a Pi resume without a transcript path', () => {
    mocks.tabsByWorktree = { [worktreeId]: [] }
    mocks.sleepingAgentSessionsByPaneKey = {}
    const action = createAutomationRunWorkspaceAction({
      store: {
        repoForRow: () => ({ id: 'repo-1' }),
        worktreeForRow: () => ({ id: worktreeId, displayName: 'Downloads' })
      },
      list: { selectedRow: { automation: { agentId: 'pi' } } }
    } as unknown as AutomationsPageActionContext)

    action(makeRun({ providerSessionId: 'pi-session' }))

    expect(mocks.createTab).not.toHaveBeenCalled()
    expect(mocks.toastMessage).toHaveBeenCalled()
  })

  it('remounts again after the first restore because the sleeping record is kept', () => {
    mocks.tabsByWorktree = { [worktreeId]: [] }
    const sleepingRecord = makeSleepingRecord()
    sleepingRecord.state = 'done'
    sleepingRecord.origin = 'live'
    sleepingRecord.restoreOnTabOpenOnly = true
    mocks.sleepingAgentSessionsByPaneKey = { [paneKey]: sleepingRecord }

    openRun()
    mocks.createTab.mockClear()
    mocks.tabsByWorktree = { [worktreeId]: [] }
    openRun()

    expect(mocks.createTab).toHaveBeenCalledTimes(1)
    expect(mocks.toastMessage).not.toHaveBeenCalled()
  })

  it('falls back to workspace-only when this run has no sleeping session', () => {
    mocks.tabsByWorktree = { [worktreeId]: [] }
    mocks.sleepingAgentSessionsByPaneKey = {}

    openRun()

    expect(mocks.activateAndRevealWorktree).toHaveBeenCalledWith(worktreeId)
    expect(mocks.createTab).not.toHaveBeenCalled()
    expect(mocks.setActiveTab).not.toHaveBeenCalled()
    expect(mocks.toastMessage).toHaveBeenCalled()
  })
})
