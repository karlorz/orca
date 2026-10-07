import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PtyPaneStartup } from './pty-connection-types'
import { createQueuedAgentResumeFailureHandler } from './queued-agent-resume-failure'
import { findQueuedAgentResumeTab } from '@/lib/queued-agent-resume-tab'

const state = vi.hoisted(() => {
  const pendingStartupByTabId: Record<string, NonNullable<PtyPaneStartup>> = {}
  const automaticAgentResumeClaimsByTabId: Record<
    string,
    {
      worktreeId: string
      launchAgent: 'grok'
      providerSession: { key: 'session_id'; id: string }
    }
  > = {}
  return { pendingStartupByTabId, automaticAgentResumeClaimsByTabId }
})
vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => state,
    setState: (update: (current: typeof state) => Partial<typeof state>) =>
      Object.assign(state, update(state))
  }
}))

function queue() {
  const startup = {
    command: 'grok --resume session-1',
    launchAgent: 'grok' as const,
    resumeProviderSession: { key: 'session_id' as const, id: 'session-1' }
  }
  state.pendingStartupByTabId.tab = startup
  state.automaticAgentResumeClaimsByTabId.tab = {
    worktreeId: 'workspace',
    launchAgent: 'grok',
    providerSession: startup.resumeProviderSession
  }
  return startup
}

beforeEach(() => {
  state.pendingStartupByTabId = {}
  state.automaticAgentResumeClaimsByTabId = {}
})

describe('queued Resume definitive spawn rejection', () => {
  it('releases the exact queued launch and claim for a later attended retry', () => {
    const startup = queue()
    const reject = createQueuedAgentResumeFailureHandler('tab', startup, startup)
    const record = {
      worktreeId: 'workspace',
      agent: 'grok' as const,
      providerSession: startup.resumeProviderSession
    }
    const snapshot = () => ({ ...state, tabsByWorktree: { workspace: [{ id: 'tab' }] } })
    expect(findQueuedAgentResumeTab(record, snapshot())).toBe('tab')
    expect(reject?.()).toBe(true)
    expect(findQueuedAgentResumeTab(record, snapshot())).toBeNull()
    expect(state.pendingStartupByTabId.tab).toBeUndefined()
    expect(state.automaticAgentResumeClaimsByTabId.tab).toBeUndefined()
    expect(reject?.()).toBe(false)
  })

  it('does not release a replacement startup or claim', () => {
    const startup = queue()
    const reject = createQueuedAgentResumeFailureHandler('tab', startup, startup)
    state.pendingStartupByTabId.tab = { ...startup }
    expect(reject?.()).toBe(false)
    state.pendingStartupByTabId.tab = startup
    state.automaticAgentResumeClaimsByTabId.tab = { ...state.automaticAgentResumeClaimsByTabId.tab }
    expect(reject?.()).toBe(false)
    state.automaticAgentResumeClaimsByTabId.tab.providerSession = { key: 'session_id', id: 'new' }
    expect(reject?.()).toBe(false)
    expect(state.pendingStartupByTabId.tab).toBe(startup)
  })

  it('matches the setup-split wrapper while fencing the original store payload', () => {
    const startup = queue()
    const wrapper = { ...startup, waitForSetupSplitDirection: 'horizontal' as const }
    const reject = createQueuedAgentResumeFailureHandler('tab', wrapper, wrapper, startup)
    expect(reject?.()).toBe(true)
  })

  it('does not let a sibling pane release the queued startup', () => {
    const startup = queue()
    expect(
      createQueuedAgentResumeFailureHandler('tab', { command: 'echo sibling' }, startup)
    ).toBeUndefined()
    expect(state.pendingStartupByTabId.tab).toBe(startup)
  })
})
