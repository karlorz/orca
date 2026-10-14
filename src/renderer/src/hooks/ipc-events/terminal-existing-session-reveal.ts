import { activateTabAndFocusPane } from '@/lib/activate-tab-and-focus-pane'
import { verifyTerminalRevealIdentity } from '@/lib/terminal-reveal-identity'
import { revealWorkspaceSurface } from '@/lib/workspace-surface-reveal'
import type {
  AgentProviderSessionMetadata,
  SleepingAgentLaunchConfig
} from '../../../../shared/agent-session-resume'
import type { AppState } from '../../store/types'

// Verified session navigation (switch-origin/switch-session) surfaces the already-bound tab.
export function surfaceExistingSessionReveal(
  store: AppState,
  payload: {
    requestId?: string
    worktreeId: string
    ptyId?: string
    tabId?: string
    leafId?: string
    command?: string
    resumeProviderSession?: AgentProviderSessionMetadata
    launchConfig?: SleepingAgentLaunchConfig
  }
): void {
  const { requestId, worktreeId, ptyId, tabId, leafId, command } = payload
  if (
    !requestId ||
    !ptyId ||
    !tabId ||
    !leafId ||
    command ||
    payload.resumeProviderSession ||
    payload.launchConfig
  ) {
    throw new Error('terminal_reveal_identity_required')
  }
  const identity = verifyTerminalRevealIdentity(store, { worktreeId, tabId, leafId, ptyId })
  revealWorkspaceSurface(store, worktreeId)
  store.setActiveTabType('terminal', worktreeId)
  store.setActiveTab(tabId)
  store.revealWorktreeInSidebar(worktreeId)
  // Why: verified session navigation is a user-requested jump — flash the pane like a notification click.
  activateTabAndFocusPane(tabId, leafId, {
    flashFocusedPane: true,
    scrollToBottomIfOutputSinceLastView: true
  })
  window.api.ui.replyTerminalCreate({
    requestId,
    tabId,
    identity
  })
}
