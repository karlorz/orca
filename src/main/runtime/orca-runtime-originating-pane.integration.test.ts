import './orca-runtime-test-lifecycle.spec'
import { describe, expect, it, vi } from 'vitest'
import type { AgentStatusIpcPayload } from '../../shared/agent-status-ipc-payload'
import {
  AgentStatusObservedPaneIdentities,
  recordObservedAgentStatusPaneIdentity
} from './agent-status-observed-pane-identity'
import { OrcaRuntimeService } from './orca-runtime-test-mocks.spec'
import { createMobileCreateTestNotifier } from './orca-runtime-test-scenario-builders.spec'
import {
  store,
  TEST_WORKTREE_ID,
  TEST_WORKTREE_PATH,
  HEADLESS_LEAF_ID
} from './orca-runtime-test-fixtures.spec'

async function makeOriginRuntime() {
  const rows: AgentStatusIpcPayload[] = []
  const observed = new AgentStatusObservedPaneIdentities()
  const runtime = new OrcaRuntimeService(store, undefined, {
    getAgentStatusSnapshot: () => rows,
    readObservedAgentStatusPaneIdentity: (paneKey) => observed.read(paneKey)
  })
  const tabId = 'origin-tab'
  const ptyId = 'origin-pty'
  const incarnationId = 'origin-incarnation'
  const paneKey = `${tabId}:${HEADLESS_LEAF_ID}`
  runtime.attachWindow(1)
  runtime.registerPty(ptyId, TEST_WORKTREE_ID, null, {
    tabId,
    leafId: HEADLESS_LEAF_ID,
    incarnationId,
    agentLaunchAuthority: { launchToken: 'origin-launch', launchAgent: 'grok' }
  })
  runtime.syncWindowGraph(1, {
    tabs: [
      {
        tabId,
        worktreeId: TEST_WORKTREE_ID,
        title: 'Origin',
        activeLeafId: HEADLESS_LEAF_ID,
        layout: null
      }
    ],
    leaves: [
      { tabId, leafId: HEADLESS_LEAF_ID, worktreeId: TEST_WORKTREE_ID, ptyId, paneRuntimeId: 1 }
    ]
  })
  const [terminal] = (await runtime.listTerminals()).terminals
  rows.push({
    paneKey,
    tabId,
    worktreeId: TEST_WORKTREE_ID,
    connectionId: null,
    agentType: 'grok',
    prompt: 'Origin probe',
    state: 'done',
    stateStartedAt: Date.now(),
    receivedAt: Date.now(),
    evidenceObservedAt: Date.now(),
    providerSession: { key: 'session_id', id: 'origin-session' },
    terminalHandle: terminal.handle,
    observation: {
      origin: 'hook',
      kind: 'transition',
      authorityId: 'test-host',
      incarnation: 1,
      revision: 1,
      observedAt: Date.now()
    }
  })
  recordObservedAgentStatusPaneIdentity(observed, paneKey, runtime)
  const reveal = vi.fn(async (_worktreeId, options) => {
    expect(options.canFocusExistingSession()).toBe(true)
    return {
      tabId,
      identity: { tabId, leafId: HEADLESS_LEAF_ID, worktreeId: TEST_WORKTREE_ID, ptyId },
      windowFocused: true,
      paneFocused: true
    }
  })
  runtime.setNotifier({ ...createMobileCreateTestNotifier(vi.fn()), revealTerminalSession: reveal })
  return { runtime, terminal, reveal, ptyId, tabId, incarnationId }
}

describe('origin navigation through the shipped runtime adapter', () => {
  it.each([undefined, TEST_WORKTREE_PATH])(
    'selects a renderer-adopted handle with workspace %s',
    async (workspace) => {
      const { runtime, terminal, reveal, ptyId, tabId, incarnationId } = await makeOriginRuntime()
      await expect(
        runtime.switchOriginatingPane({ provider: 'grok', session: 'origin-session', workspace })
      ).resolves.toMatchObject({
        provider: 'grok',
        sessionId: 'origin-session',
        handle: terminal.handle,
        ptyId,
        tabId,
        leafId: HEADLESS_LEAF_ID,
        incarnationId,
        navigated: true
      })
      expect(reveal).toHaveBeenCalledTimes(1)
    }
  )

  it('refuses a different workspace before revealing the pane', async () => {
    const { runtime, reveal } = await makeOriginRuntime()
    await expect(
      runtime.switchOriginatingPane({
        provider: 'grok',
        session: 'origin-session',
        workspace: '/foreign/workspace'
      })
    ).rejects.toThrow('session_binding_unverifiable')
    expect(reveal).not.toHaveBeenCalled()
  })
})
