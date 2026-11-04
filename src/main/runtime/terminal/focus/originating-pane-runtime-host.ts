import type { AgentStatusIpcPayload } from '../../../../shared/agent-status-ipc-payload'
import type { ObservedAgentStatusPaneIdentity } from '../../../ipc/agent-status-ipc-boundary'
import type { TerminalRevealIdentity } from '../../../../shared/terminal-reveal-identity'
import type { TerminalOriginatingPaneHost } from '../../terminal-originating-pane-navigation-types'
import type { FocusTerminalOptions, LivePtyHandle } from '../../orca-runtime-guarded-pty-reveal'

export type OriginatingPaneRuntime = {
  getAgentStatusSnapshotFn?: (() => AgentStatusIpcPayload[]) | null
  readObservedAgentStatusPaneIdentityFn: (paneKey: string) => ObservedAgentStatusPaneIdentity
  getLivePtyForHandle: (handle: string) => LivePtyHandle | null
  getLivePtyForRetainedHandle: (handle: string) => LivePtyHandle | null
  assertGraphReady: () => void
  leaves: Map<string, { tabId: string; leafId: string; ptyId?: string | null; worktreeId: string }>
  getLeafKey: (tabId: string, leafId: string) => string
  resolveWorktreeSelector: (selector: string) => Promise<{
    id: string
    git: { path?: string }
    rootPath?: string
  }>
  focusTerminal: (
    handle: string,
    options?: FocusTerminalOptions
  ) => Promise<{
    navigated?: boolean
    tabId?: string
    worktreeId?: string
    identity?: TerminalRevealIdentity
    windowFocused?: boolean
    paneFocused?: boolean
  }>
}

export function originatingPaneRuntimeHost(
  runtime: OriginatingPaneRuntime
): TerminalOriginatingPaneHost {
  return {
    getAgentStatusSnapshot: () => runtime.getAgentStatusSnapshotFn?.() ?? [],
    readObservedAgentStatusPaneIdentity: (paneKey: string) =>
      runtime.readObservedAgentStatusPaneIdentityFn(paneKey),
    getLivePtyForHandle: (handle: string) => {
      const live =
        runtime.getLivePtyForHandle(handle) ?? runtime.getLivePtyForRetainedHandle(handle)
      if (!live) {
        return null
      }
      return {
        record: {
          ...(live.record.handle ? { handle: live.record.handle } : {}),
          ...(live.record.ptyId ? { ptyId: live.record.ptyId } : {})
        },
        pty: {
          ptyId: live.pty.ptyId,
          incarnationId: live.pty.incarnationId,
          ...(live.pty.paneKey == null ? {} : { paneKey: live.pty.paneKey }),
          worktreeId: live.pty.worktreeId,
          tabId: live.pty.tabId ?? null,
          connected: live.pty.connected,
          connectionId: live.pty.connectionId,
          ...(live.pty.isWsl == null ? {} : { isWsl: live.pty.isWsl })
        }
      }
    },
    getRendererLeaf: (tabId: string, leafId: string) => {
      runtime.assertGraphReady()
      return runtime.leaves.get(runtime.getLeafKey(tabId, leafId)) ?? null
    },
    resolveWorktree: async (worktreeId: string) => {
      try {
        const resolved = await runtime.resolveWorktreeSelector(`id:${worktreeId}`)
        const rootPath = 'rootPath' in resolved ? resolved.rootPath : undefined
        return {
          id: resolved.id,
          path: resolved.git.path,
          ...(typeof rootPath === 'string' ? { rootPath } : {})
        }
      } catch {
        return null
      }
    },
    focusTerminal: async (handle, options) => {
      const focused = await runtime.focusTerminal(handle, options)
      return {
        navigated: focused.navigated === true,
        tabId: focused.tabId,
        worktreeId: focused.worktreeId,
        identity: focused.identity,
        windowFocused: focused.windowFocused,
        paneFocused: focused.paneFocused
      }
    }
  }
}
