import { describe, expect, it } from 'vitest'
import type { SleepingAgentSessionRecord } from '../../../../shared/agent-session-resume'
import { singlePaneLayoutSnapshot } from '@/store/slices/terminal-helpers'
import {
  findAutomationRunResumeTarget,
  type AutomationRunResumeState
} from './automation-run-resume-target'

const leafId = '11111111-1111-4111-8111-111111111111'
const record: SleepingAgentSessionRecord = {
  paneKey: `original:${leafId}`,
  tabId: 'original',
  worktreeId: 'workspace',
  agent: 'claude',
  providerSession: { key: 'session_id', id: 'conversation' },
  state: 'done',
  prompt: '',
  origin: 'live',
  capturedAt: 1,
  updatedAt: 1
}

function makeState(): AutomationRunResumeState {
  return {
    tabsByWorktree: { workspace: [{ id: 'resumed' }] },
    pendingStartupByTabId: {},
    automaticAgentResumeClaimsByTabId: {},
    agentStatusByPaneKey: {},
    sleepingAgentSessionsByPaneKey: {},
    ptyIdsByTabId: {},
    terminalLayoutsByTabId: { resumed: singlePaneLayoutSnapshot(leafId) }
  }
}

function makeLiveState(): AutomationRunResumeState {
  const state = makeState()
  state.agentStatusByPaneKey[`resumed:${leafId}`] = {
    paneKey: `resumed:${leafId}`,
    tabId: 'resumed',
    worktreeId: 'workspace',
    agentType: 'claude',
    providerSession: record.providerSession
  }
  state.ptyIdsByTabId.resumed = ['pty-live']
  state.terminalLayoutsByTabId.resumed = singlePaneLayoutSnapshot(leafId, 'pty-live')
  return state
}

describe('automation run resume target', () => {
  it('finds the pending startup before the first PTY binds', () => {
    const state = makeState()
    state.pendingStartupByTabId.resumed = {
      launchAgent: 'claude',
      resumeProviderSession: record.providerSession
    }
    expect(findAutomationRunResumeTarget(record, state)).toEqual({ tabId: 'resumed' })
  })

  it('finds a claim after startup was consumed but before the hook arrives', () => {
    const state = makeState()
    state.automaticAgentResumeClaimsByTabId.resumed = {
      worktreeId: 'workspace',
      launchAgent: 'claude',
      providerSession: record.providerSession
    }
    expect(findAutomationRunResumeTarget(record, state)).toEqual({ tabId: 'resumed' })
  })

  it('finds a live provider pane without depending on turn state', () => {
    expect(findAutomationRunResumeTarget(record, makeLiveState())).toEqual({
      tabId: 'resumed',
      leafId
    })
  })

  it('finds a preserved hibernated resume pane', () => {
    const state = makeState()
    state.sleepingAgentSessionsByPaneKey[`resumed:${leafId}`] = {
      ...record,
      paneKey: `resumed:${leafId}`,
      tabId: 'resumed'
    }
    expect(findAutomationRunResumeTarget(record, state)).toEqual({ tabId: 'resumed', leafId })
  })

  it('ignores stale status and layout bindings when no PTY is live', () => {
    const state = makeLiveState()
    state.ptyIdsByTabId.resumed = []
    expect(findAutomationRunResumeTarget(record, state)).toBeNull()
  })

  it('ignores claims and sleeping records after their tab closes', () => {
    const state = makeState()
    state.tabsByWorktree.workspace = []
    state.automaticAgentResumeClaimsByTabId.resumed = {
      worktreeId: 'workspace',
      launchAgent: 'claude',
      providerSession: record.providerSession
    }
    state.sleepingAgentSessionsByPaneKey[`resumed:${leafId}`] = {
      ...record,
      paneKey: `resumed:${leafId}`,
      tabId: 'resumed'
    }
    expect(findAutomationRunResumeTarget(record, state)).toBeNull()
  })

  it('does not match another workspace or host-qualified workspace', () => {
    const state = makeLiveState()
    state.tabsByWorktree = { 'remote:workspace': [{ id: 'resumed' }] }
    expect(findAutomationRunResumeTarget(record, state)).toBeNull()
  })

  it('does not match another agent or conversation', () => {
    const state = makeLiveState()
    state.agentStatusByPaneKey[`resumed:${leafId}`].agentType = 'codex'
    expect(findAutomationRunResumeTarget(record, state)).toBeNull()
    state.agentStatusByPaneKey[`resumed:${leafId}`].agentType = 'claude'
    state.agentStatusByPaneKey[`resumed:${leafId}`].providerSession = {
      key: 'session_id',
      id: 'different'
    }
    expect(findAutomationRunResumeTarget(record, state)).toBeNull()
  })

  it('rejects conflicting status workspace or tab ownership', () => {
    const state = makeLiveState()
    state.agentStatusByPaneKey[`resumed:${leafId}`].worktreeId = 'other'
    expect(findAutomationRunResumeTarget(record, state)).toBeNull()
    state.agentStatusByPaneKey[`resumed:${leafId}`].worktreeId = 'workspace'
    state.agentStatusByPaneKey[`resumed:${leafId}`].tabId = 'other'
    expect(findAutomationRunResumeTarget(record, state)).toBeNull()
  })

  it('requires the same Pi transcript path', () => {
    const state = makeState()
    state.pendingStartupByTabId.resumed = {
      launchAgent: 'pi',
      resumeProviderSession: { ...record.providerSession, transcriptPath: '/other.jsonl' }
    }
    expect(
      findAutomationRunResumeTarget(
        {
          ...record,
          agent: 'pi',
          providerSession: { ...record.providerSession, transcriptPath: '/expected.jsonl' }
        },
        state
      )
    ).toBeNull()
  })
})
