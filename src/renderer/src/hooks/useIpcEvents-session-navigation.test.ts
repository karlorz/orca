import { describe, expect, it } from 'vitest'
import { setupTerminalCreateSurfacing } from './ipc-events-terminal-create-test-harness'

describe('existing-session-only reveal', () => {
  it('refuses missing and mismatched destinations without creating or resuming a chat', async () => {
    const scenario = await setupTerminalCreateSurfacing(() => false)
    const listener = scenario.createTerminalListenerRef.current
    if (!listener) {
      throw new Error('Missing terminal reveal listener')
    }
    listener({
      requestId: 'navigation',
      worktreeId: 'wt-1',
      ptyId: 'pty-1',
      tabId: 'missing',
      leafId: 'leaf-1',
      existingSessionOnly: true
    })
    expect(scenario.replyTerminalCreate).toHaveBeenCalledWith({
      requestId: 'navigation',
      error: 'terminal_reveal_identity_mismatch'
    })
    expect(scenario.createTab).not.toHaveBeenCalled()
    expect(scenario.queueTabStartupCommand).not.toHaveBeenCalled()
    expect(scenario.setActiveWorktree).not.toHaveBeenCalled()
  })

  it('selects the already bound tab without changing layout, launch configuration or question input', async () => {
    const scenario = await setupTerminalCreateSurfacing(() => false)
    scenario.storeState.tabsByWorktree['wt-1'] = [
      { id: 'tab-1', ptyId: 'pty-1', title: 'same title' }
    ]
    scenario.storeState.terminalLayoutsByTabId['tab-1'] = {
      root: { type: 'leaf', leafId: 'leaf-1' },
      activeLeafId: 'leaf-1',
      expandedLeafId: null,
      ptyIdsByLeafId: { 'leaf-1': 'pty-1' }
    }
    const listener = scenario.createTerminalListenerRef.current
    if (!listener) {
      throw new Error('Missing terminal reveal listener')
    }
    listener({
      requestId: 'navigation',
      worktreeId: 'wt-1',
      ptyId: 'pty-1',
      tabId: 'tab-1',
      leafId: 'leaf-1',
      existingSessionOnly: true
    })
    expect(scenario.setActiveTab).toHaveBeenCalledWith('tab-1')
    expect(scenario.replyTerminalCreate).toHaveBeenCalledWith({
      requestId: 'navigation',
      tabId: 'tab-1',
      identity: { worktreeId: 'wt-1', tabId: 'tab-1', leafId: 'leaf-1', ptyId: 'pty-1' }
    })
    expect(scenario.createTab).not.toHaveBeenCalled()
    expect(scenario.queueTabStartupCommand).not.toHaveBeenCalled()
    expect(scenario.setTabLayout).not.toHaveBeenCalled()
    expect(scenario.registerAgentLaunchConfig).not.toHaveBeenCalled()
  })
})
