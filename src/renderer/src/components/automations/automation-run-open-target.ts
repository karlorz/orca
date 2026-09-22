import type { AutomationRun } from '../../../../shared/automations-types'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import type {
  TerminalLayoutSnapshot,
  TerminalPaneLayoutNode
} from '../../../../shared/terminal-tab-types'

export type AutomationRunPaneTarget = {
  tabId: string
  paneKey: string
  leafId: string
  ptyId: string | null
}

export function getAutomationRunOpenTabId(
  run: Pick<AutomationRun, 'terminalPaneKey'>
): string | null {
  return parsePaneKey(run.terminalPaneKey ?? '')?.tabId ?? null
}

/** Same source the click path uses (`tabsByWorktree`), not leftover unified-tab ghosts. */
export function automationRunTerminalTabExists({
  run,
  tabsByWorktree
}: {
  run: Pick<AutomationRun, 'terminalPaneKey' | 'workspaceId'>
  tabsByWorktree: Record<string, readonly { id: string }[] | undefined>
}): boolean {
  const tabId = getAutomationRunOpenTabId(run)
  if (!tabId || !run.workspaceId) {
    return false
  }
  return (tabsByWorktree[run.workspaceId] ?? []).some((tab) => tab.id === tabId)
}

export function selectAutomationRunPaneMounted(
  state: {
    tabsByWorktree: Record<string, readonly { id: string }[] | undefined>
    terminalLayoutsByTabId: Record<string, TerminalLayoutSnapshot | undefined>
  },
  run: Pick<AutomationRun, 'terminalPaneKey' | 'workspaceId'>
): boolean {
  const openTabId = getAutomationRunOpenTabId(run)
  return canOpenAutomationRunOpenTarget({
    run,
    terminalTabExists: automationRunTerminalTabExists({
      run,
      tabsByWorktree: state.tabsByWorktree
    }),
    currentLayout: openTabId ? state.terminalLayoutsByTabId[openTabId] : null
  })
}

export function automationRunMatchesPaneKey(
  run: Pick<AutomationRun, 'terminalPaneKey'>,
  paneKey: string
): boolean {
  return run.terminalPaneKey ? paneKey === run.terminalPaneKey : false
}

export function isAutomationRunPaneMounted({
  run,
  terminalTabExists,
  currentLayout
}: {
  run: Pick<AutomationRun, 'terminalPaneKey'>
  terminalTabExists: boolean
  currentLayout: TerminalLayoutSnapshot | null | undefined
}): boolean {
  const parsed = parsePaneKey(run.terminalPaneKey ?? '')
  if (!terminalTabExists || !parsed || !currentLayout?.root) {
    return false
  }
  return terminalLayoutContainsLeaf(currentLayout.root, parsed.leafId)
}

export function resolveAutomationRunOpenTarget({
  run,
  terminalTabExists,
  currentLayout,
  livePtyIds
}: {
  run: AutomationRun
  terminalTabExists: boolean
  currentLayout: TerminalLayoutSnapshot | null | undefined
  livePtyIds: readonly string[]
}): AutomationRunPaneTarget | null {
  const parsed = parsePaneKey(run.terminalPaneKey ?? '')
  if (!isAutomationRunPaneMounted({ run, terminalTabExists, currentLayout }) || !parsed) {
    return null
  }
  const layoutPtyId = currentLayout?.ptyIdsByLeafId?.[parsed.leafId]
  const ptyId =
    run.terminalPtyId && livePtyIds.includes(run.terminalPtyId)
      ? run.terminalPtyId
      : (layoutPtyId ?? run.terminalPtyId ?? null)
  return {
    tabId: parsed.tabId,
    paneKey: run.terminalPaneKey!,
    leafId: parsed.leafId,
    ptyId
  }
}

export function canOpenAutomationRunOpenTarget(args: {
  run: Pick<AutomationRun, 'terminalPaneKey'>
  terminalTabExists: boolean
  currentLayout: TerminalLayoutSnapshot | null | undefined
  livePtyIds?: readonly string[]
}): boolean {
  return isAutomationRunPaneMounted(args)
}

export function buildAutomationRunOpenLayout({
  target,
  currentLayout
}: {
  target: AutomationRunPaneTarget
  currentLayout: TerminalLayoutSnapshot
}): TerminalLayoutSnapshot {
  return {
    ...currentLayout,
    activeLeafId: target.leafId,
    expandedLeafId: currentLayout.expandedLeafId === target.leafId ? target.leafId : null,
    ptyIdsByLeafId: target.ptyId
      ? {
          ...currentLayout.ptyIdsByLeafId,
          [target.leafId]: target.ptyId
        }
      : currentLayout.ptyIdsByLeafId
  }
}

function terminalLayoutContainsLeaf(node: TerminalPaneLayoutNode, leafId: string): boolean {
  if (node.type === 'leaf') {
    return node.leafId === leafId
  }
  return (
    terminalLayoutContainsLeaf(node.first, leafId) ||
    terminalLayoutContainsLeaf(node.second, leafId)
  )
}
