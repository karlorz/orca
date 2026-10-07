import type { AgentStatusIpcPayload } from '../../shared/agent-status-ipc-payload'
import type { ObservedAgentStatusPaneIdentity } from '../ipc/agent-status-ipc-boundary'
import type { TerminalRevealIdentity } from '../../shared/terminal-reveal-identity'

export type OriginatingPaneProvider = 'grok' | 'codex' | 'claude' | 'cursor'
export type OriginatingPaneTarget = {
  provider: OriginatingPaneProvider
  session: string
  workspace?: string
}

export type OriginatingPaneNavigationReceipt = {
  provider: OriginatingPaneProvider
  sessionId: string
  handle: string
  tabId: string
  leafId: string
  worktreeId: string
  ptyId: string
  incarnationId: string
  navigated: true
  windowFocused?: boolean
  paneFocused?: boolean
}

export type OriginatingPaneCandidate = {
  provider: OriginatingPaneProvider
  sessionId: string
  paneKey: string
  handle: string
  processIncarnation: string
  ptyId: string
  incarnationId: string
  tabId: string
  leafId: string
  worktreeId: string
}

export type TerminalOriginatingPaneHost = {
  getAgentStatusSnapshot(): readonly AgentStatusIpcPayload[]
  readObservedAgentStatusPaneIdentity(paneKey: string): ObservedAgentStatusPaneIdentity
  getLivePtyForHandle(handle: string): {
    record: { handle?: string; ptyId?: string }
    pty: {
      ptyId: string
      incarnationId: string | null
      paneKey?: string | null
      worktreeId: string
      tabId: string | null
      connected: boolean
      connectionId: string | null
      isWsl?: boolean
    }
  } | null
  getRendererLeaf(
    tabId: string,
    leafId: string
  ): { tabId: string; leafId: string; ptyId?: string | null; worktreeId: string } | null
  resolveWorktree(
    worktreeId: string
  ): Promise<{ id: string; path?: string; rootPath?: string } | null>
  focusTerminal(
    handle: string,
    options: {
      expectedIncarnationId?: string
      existingSessionOnly?: boolean
      verifySession?: () => boolean
      activateHostWindow?: boolean
    }
  ): Promise<{
    navigated: boolean
    tabId?: string
    worktreeId?: string
    identity?: TerminalRevealIdentity
    windowFocused?: boolean
    paneFocused?: boolean
  }>
  now?(): number
}
