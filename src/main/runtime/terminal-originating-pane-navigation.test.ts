import { describe, expect, it, vi } from 'vitest'
import {
  switchOriginatingPaneWithHost,
  type TerminalOriginatingPaneHost
} from './terminal-originating-pane-navigation'
import type { AgentStatusIpcPayload } from '../../shared/agent-status-ipc-payload'
import { AGENT_STATUS_STALE_AFTER_MS } from '../../shared/agent-status-types'

function makeFixture(now = 1_000_000) {
  const ptyId = 'pty-1'
  const incarnationId = 'inc-1'
  const tabId = 'tab-1'
  const leafId = '11111111-1111-4111-8111-111111111111'
  const paneKey = `${tabId}:${leafId}`
  const handle = 'handle-1'
  const worktreeId = 'wt-1'
  const processIncarnation = `${ptyId}:${incarnationId}`

  const status: AgentStatusIpcPayload = {
    agentType: 'grok',
    state: 'working',
    prompt: 'ship it',
    paneKey,
    connectionId: null,
    receivedAt: now - 500,
    evidenceObservedAt: now - 500,
    stateStartedAt: now - 1000,
    providerSession: { key: 'session_id', id: 'session-123' },
    observation: {
      origin: 'hook',
      authorityId: 'auth-1',
      incarnation: 1,
      revision: 1,
      observedAt: now - 500,
      kind: 'transition'
    }
  }

  const livePty = {
    record: { handle, ptyId },
    pty: {
      ptyId,
      incarnationId,
      paneKey,
      worktreeId,
      tabId,
      connected: true,
      connectionId: null as string | null,
      isWsl: false
    }
  }

  const host: TerminalOriginatingPaneHost = {
    now: () => now,
    getAgentStatusSnapshot: vi.fn(() => [status]),
    readObservedAgentStatusPaneIdentity: vi.fn((key: string) => {
      if (key === paneKey) {
        return {
          kind: 'observed' as const,
          terminalHandle: handle,
          processIncarnation,
          dispatchId: null
        }
      }
      return { kind: 'unobserved' as const }
    }),
    getLivePtyForHandle: vi.fn((h: string) => {
      if (h === handle) {
        return livePty
      }
      return null
    }),
    getRendererLeaf: vi.fn((t: string, l: string) => {
      if (t === tabId && l === leafId) {
        return { tabId, leafId, ptyId, worktreeId }
      }
      return null
    }),
    resolveWorktree: vi.fn(async (id: string) => {
      if (id === worktreeId) {
        return { id: worktreeId, path: '/path/to/wt-1', rootPath: '/path/to/wt-1' }
      }
      return null
    }),
    focusTerminal: vi.fn(async (_h: string, opts) => {
      if (opts.verifySession && !opts.verifySession()) {
        throw new Error('session_navigation_unverifiable')
      }
      return {
        navigated: true,
        tabId,
        worktreeId,
        identity: {
          ptyId,
          tabId,
          leafId,
          worktreeId
        },
        windowFocused: true,
        paneFocused: true
      }
    })
  }

  return {
    now,
    host,
    status,
    ptyId,
    incarnationId,
    tabId,
    leafId,
    paneKey,
    handle,
    worktreeId,
    processIncarnation
  }
}

describe('terminal-originating-pane-navigation', () => {
  it('successfully navigates when status and terminal state match exactly', async () => {
    const { host, leafId } = makeFixture()
    const receipt = await switchOriginatingPaneWithHost(host, {
      provider: 'grok',
      session: 'session-123'
    })
    expect(receipt).toEqual({
      provider: 'grok',
      sessionId: 'session-123',
      handle: 'handle-1',
      tabId: 'tab-1',
      leafId,
      worktreeId: 'wt-1',
      ptyId: 'pty-1',
      incarnationId: 'inc-1',
      navigated: true,
      windowFocused: true,
      paneFocused: true
    })
  })

  it('selects distinct sessions in one workspace through their exact live panes', async () => {
    const first = makeFixture()
    const second = makeFixture()
    second.status.providerSession = { key: 'session_id', id: 'session-456' }
    const secondLeafId = '22222222-2222-4222-8222-222222222222'
    const secondPaneKey = `tab-2:${secondLeafId}`
    second.status.paneKey = secondPaneKey
    const secondLive = second.host.getLivePtyForHandle(second.handle)!
    Object.assign(secondLive.pty, {
      ptyId: 'pty-2',
      incarnationId: 'inc-2',
      tabId: 'tab-2',
      paneKey: secondPaneKey
    })
    secondLive.record.handle = 'handle-2'
    secondLive.record.ptyId = 'pty-2'
    const host: TerminalOriginatingPaneHost = {
      ...first.host,
      getAgentStatusSnapshot: () => [first.status, second.status],
      readObservedAgentStatusPaneIdentity: (paneKey) =>
        paneKey === first.paneKey
          ? first.host.readObservedAgentStatusPaneIdentity(paneKey)
          : {
              kind: 'observed',
              terminalHandle: 'handle-2',
              processIncarnation: 'pty-2:inc-2',
              dispatchId: null
            },
      getLivePtyForHandle: (handle) =>
        handle === 'handle-2' ? secondLive : first.host.getLivePtyForHandle(handle),
      getRendererLeaf: (tabId, leafId) =>
        tabId === 'tab-2' && leafId === secondLeafId
          ? { tabId, leafId, ptyId: 'pty-2', worktreeId: first.worktreeId }
          : first.host.getRendererLeaf(tabId, leafId),
      focusTerminal: vi.fn(async (handle, options) => {
        expect(options.existingSessionOnly).toBe(true)
        expect(options.verifySession?.()).toBe(true)
        const isSecond = handle === 'handle-2'
        return {
          navigated: true,
          identity: {
            ptyId: isSecond ? 'pty-2' : first.ptyId,
            tabId: isSecond ? 'tab-2' : first.tabId,
            leafId: isSecond ? secondLeafId : first.leafId,
            worktreeId: first.worktreeId
          }
        }
      })
    }
    const a = await switchOriginatingPaneWithHost(host, {
      provider: 'grok',
      session: 'session-123',
      workspace: '/path/to/wt-1'
    })
    const b = await switchOriginatingPaneWithHost(host, {
      provider: 'grok',
      session: 'session-456',
      workspace: '/path/to/wt-1'
    })
    expect([a.handle, b.handle]).toEqual(['handle-1', 'handle-2'])
    expect([a.leafId, b.leafId]).toEqual([first.leafId, secondLeafId])
    expect([a.incarnationId, b.incarnationId]).toEqual(['inc-1', 'inc-2'])
    expect(host.focusTerminal).toHaveBeenCalledTimes(2)
  })

  it('rejects ambiguous sessions matching multiple panes even if one is invalid', async () => {
    const { host, status } = makeFixture()
    const status2: AgentStatusIpcPayload = {
      ...status,
      paneKey: 'tab-2:leaf-2'
    }
    vi.mocked(host.getAgentStatusSnapshot).mockReturnValue([status, status2])

    await expect(
      switchOriginatingPaneWithHost(host, {
        provider: 'grok',
        session: 'session-123'
      })
    ).rejects.toThrow('session_binding_ambiguous')
  })

  it('rejects stale status where observedAt > AGENT_STATUS_STALE_AFTER_MS', async () => {
    const { host, status, now } = makeFixture()
    status.evidenceObservedAt = now - AGENT_STATUS_STALE_AFTER_MS - 1
    status.receivedAt = now - 500
    await expect(
      switchOriginatingPaneWithHost(host, {
        provider: 'grok',
        session: 'session-123'
      })
    ).rejects.toThrow('session_binding_unverifiable')
  })

  it('rejects status with observedAt in the future (> now + 60s)', async () => {
    const { host, status, now } = makeFixture()
    status.evidenceObservedAt = now + 60_001
    status.receivedAt = now + 60_001
    await expect(
      switchOriginatingPaneWithHost(host, {
        provider: 'grok',
        session: 'session-123'
      })
    ).rejects.toThrow('session_binding_unverifiable')
  })

  it('rejects replay observation with kind snapshot or non-transition', async () => {
    const { host, status } = makeFixture()
    status.observation!.kind = 'snapshot'
    await expect(
      switchOriginatingPaneWithHost(host, {
        provider: 'grok',
        session: 'session-123'
      })
    ).rejects.toThrow('session_binding_unverifiable')
  })

  it('rejects non-hook origin (e.g. title or osc)', async () => {
    const { host, status } = makeFixture()
    status.observation!.origin = 'title' as unknown as 'hook'
    await expect(
      switchOriginatingPaneWithHost(host, {
        provider: 'grok',
        session: 'session-123'
      })
    ).rejects.toThrow('session_binding_unverifiable')
  })

  it('rejects restoredUnconfirmed or providerSessionOnly status rows', async () => {
    const { host, status } = makeFixture()
    status.restoredUnconfirmed = true
    await expect(
      switchOriginatingPaneWithHost(host, {
        provider: 'grok',
        session: 'session-123'
      })
    ).rejects.toThrow('session_binding_unverifiable')

    status.restoredUnconfirmed = false
    status.providerSessionOnly = true
    await expect(
      switchOriginatingPaneWithHost(host, {
        provider: 'grok',
        session: 'session-123'
      })
    ).rejects.toThrow('session_binding_unverifiable')
  })

  it('refuses remote SSH or WSL connections with session_navigation_host_required', async () => {
    const { host, status } = makeFixture()
    status.connectionId = 'ssh-conn-1'
    await expect(
      switchOriginatingPaneWithHost(host, {
        provider: 'grok',
        session: 'session-123'
      })
    ).rejects.toThrow('session_navigation_host_required')

    status.connectionId = null
    const live = host.getLivePtyForHandle('handle-1')!
    live.pty.isWsl = true
    await expect(
      switchOriginatingPaneWithHost(host, {
        provider: 'grok',
        session: 'session-123'
      })
    ).rejects.toThrow('session_navigation_host_required')
  })

  it('rejects when process incarnation changed / replaced', async () => {
    const { host, handle } = makeFixture()
    vi.mocked(host.readObservedAgentStatusPaneIdentity).mockReturnValue({
      kind: 'observed',
      terminalHandle: handle,
      processIncarnation: 'pty-1:different-inc',
      dispatchId: null
    })
    await expect(
      switchOriginatingPaneWithHost(host, {
        provider: 'grok',
        session: 'session-123'
      })
    ).rejects.toThrow('session_binding_unverifiable')
  })

  it('rejects when renderer graph leaf is missing or inconsistent', async () => {
    const { host } = makeFixture()
    vi.mocked(host.getRendererLeaf).mockReturnValue(null)
    await expect(
      switchOriginatingPaneWithHost(host, {
        provider: 'grok',
        session: 'session-123'
      })
    ).rejects.toThrow('session_binding_unverifiable')
  })

  it('rejects when focusTerminal receipt has wrong identity or navigated false', async () => {
    const { host } = makeFixture()
    vi.mocked(host.focusTerminal).mockResolvedValueOnce({
      navigated: false
    })
    await expect(
      switchOriginatingPaneWithHost(host, {
        provider: 'grok',
        session: 'session-123'
      })
    ).rejects.toThrow('session_navigation_unverifiable')

    vi.mocked(host.focusTerminal).mockResolvedValueOnce({
      navigated: true,
      identity: {
        ptyId: 'pty-wrong',
        tabId: 'tab-1',
        leafId: '11111111-1111-4111-8111-111111111111',
        worktreeId: 'wt-1'
      }
    })
    await expect(
      switchOriginatingPaneWithHost(host, {
        provider: 'grok',
        session: 'session-123'
      })
    ).rejects.toThrow('session_navigation_unverifiable')
  })

  it('validates workspace selector matching worktree', async () => {
    const { host } = makeFixture()
    const receipt = await switchOriginatingPaneWithHost(host, {
      provider: 'grok',
      session: 'session-123',
      workspace: '/path/to/wt-1'
    })
    expect(receipt.navigated).toBe(true)

    await expect(
      switchOriginatingPaneWithHost(host, {
        provider: 'grok',
        session: 'session-123',
        workspace: '/different/path'
      })
    ).rejects.toThrow('session_binding_unverifiable')
  })

  it.each(['missing', 'ambiguous', 'stale', 'replay', 'remote'] as const)(
    'refuses %s evidence introduced during workspace resolution before focus',
    async (change) => {
      const { host, status, now } = makeFixture()
      vi.mocked(host.resolveWorktree).mockImplementation(async () => {
        if (change === 'missing') {
          vi.mocked(host.getAgentStatusSnapshot).mockReturnValue([])
        } else if (change === 'ambiguous') {
          vi.mocked(host.getAgentStatusSnapshot).mockReturnValue([
            status,
            { ...status, paneKey: 'other:leaf' }
          ])
        } else if (change === 'stale') {
          status.evidenceObservedAt = now - AGENT_STATUS_STALE_AFTER_MS - 1
        } else if (change === 'replay') {
          status.observation!.kind = 'snapshot'
        } else {
          status.connectionId = 'remote'
        }
        return { id: 'wt-1', path: '/path/to/wt-1' }
      })
      await expect(
        switchOriginatingPaneWithHost(host, {
          provider: 'grok',
          session: 'session-123',
          workspace: '/path/to/wt-1'
        })
      ).rejects.toThrow('session_navigation_unverifiable')
      expect(host.focusTerminal).not.toHaveBeenCalled()
    }
  )

  it('refuses a receipt when status disappears during focus', async () => {
    const { host } = makeFixture()
    const focus = vi.mocked(host.focusTerminal).getMockImplementation()!
    vi.mocked(host.focusTerminal).mockImplementation(async (handle, options) => {
      const receipt = await focus(handle, options)
      vi.mocked(host.getAgentStatusSnapshot).mockReturnValue([])
      return receipt
    })
    await expect(
      switchOriginatingPaneWithHost(host, { provider: 'grok', session: 'session-123' })
    ).rejects.toThrow('session_navigation_unverifiable')
  })

  it('rejects if provider changes in same pane', async () => {
    const { host, status } = makeFixture()
    status.agentType = 'claude'
    await expect(
      switchOriginatingPaneWithHost(host, {
        provider: 'grok',
        session: 'session-123'
      })
    ).rejects.toThrow('session_binding_unverifiable')
  })
})
