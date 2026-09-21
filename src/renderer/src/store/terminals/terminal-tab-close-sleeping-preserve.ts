import { collectLeafIds } from '@/components/terminal-pane/terminal-pane-layout-tree'
import type { TerminalStoreGet } from './terminal-state'

function worktreeIdForClosingTerminalTab(
  state: ReturnType<TerminalStoreGet>,
  tabId: string
): string | null {
  for (const [id, tabs] of Object.entries(state.tabsByWorktree)) {
    if (tabs.some((tab) => tab.id === tabId)) {
      return id
    }
  }
  // Why: hydrated unified-only terminals have no tabsByWorktree row; close still
  // must capture the provider session before the pane is torn down.
  for (const [id, tabs] of Object.entries(state.unifiedTabsByWorktree ?? {})) {
    if (tabs.some((tab) => tab.contentType === 'terminal' && tab.entityId === tabId)) {
      return id
    }
  }
  for (const entry of Object.values(state.agentStatusByPaneKey ?? {})) {
    if (entry.paneKey.startsWith(`${tabId}:`) && entry.worktreeId) {
      return entry.worktreeId
    }
  }
  return null
}

/** Recapture a still-resumable session before user close drops its live pane. */
export function captureSleepingSessionsBeforeUserTabClose(
  get: TerminalStoreGet,
  tabId: string
): void {
  const state = get()
  const worktreeId = worktreeIdForClosingTerminalTab(state, tabId)
  if (!worktreeId) {
    return
  }
  const paneKeys = collectLeafIds(state.terminalLayoutsByTabId[tabId]?.root).map(
    (leafId) => `${tabId}:${leafId}`
  )
  if (paneKeys.length === 0) {
    for (const paneKey of Object.keys(state.agentStatusByPaneKey)) {
      if (paneKey.startsWith(`${tabId}:`)) {
        paneKeys.push(paneKey)
      }
    }
  }
  if (paneKeys.length === 0) {
    return
  }
  state.captureSleepingAgentSessionsByWorktree(worktreeId, paneKeys)
}
