import type { AutomationRun } from '../../../../shared/automations-types'
import { makePaneKey, parsePaneKey } from '../../../../shared/stable-pane-id'
import { parseRemoteRuntimePtyId } from '../../../../shared/remote-runtime-pty-id'
import {
  isWebTerminalSurfaceTabId,
  toWebTerminalSurfaceTabId
} from '../../../../shared/terminal-surface-id'
import type { TerminalLayoutSnapshot } from '../../../../shared/terminal-tab-types'
import { terminalLayoutContainsLeaf } from '../../../../shared/workspace-session-pane-ownership'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import { resolveOwner } from '@/lib/resolve-owner'
import type { WorktreeOperationRouteState } from '@/lib/worktree-operation-route'

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

export type AutomationRunTerminalState = {
  hasTerminalTab: (tabId: string) => boolean
  terminalLayoutsByTabId: Readonly<Record<string, TerminalLayoutSnapshot | undefined>>
  ptyIdsByTabId: Readonly<Record<string, readonly string[] | undefined>>
}

/**
 * The run's pane in this client. A run on a paired server names the server's tab, pane and PTY;
 * this client shows that pane as a mirrored tab whose PTY id is the server's terminal handle, so
 * the server's PTY id cannot be compared and the mirrored pane must carry a PTY from that server.
 */
export function resolveAutomationRunTerminalTarget(
  run: AutomationRun,
  terminals: AutomationRunTerminalState,
  ownerEnvironmentId: string | null
): AutomationRunPaneTarget | null {
  const tabId = getAutomationRunOpenTabId(run)
  if (!tabId) {
    return null
  }
  const local = resolveAutomationRunOpenTarget({
    run,
    terminalTabExists: terminals.hasTerminalTab(tabId),
    currentLayout: terminals.terminalLayoutsByTabId[tabId],
    livePtyIds: terminals.ptyIdsByTabId[tabId] ?? []
  })
  const parsed = parsePaneKey(run.terminalPaneKey ?? '')
  if (local || !ownerEnvironmentId || !parsed || isWebTerminalSurfaceTabId(tabId)) {
    return local
  }
  const mirroredTabId = toWebTerminalSurfaceTabId(tabId)
  const layout = terminals.terminalLayoutsByTabId[mirroredTabId]
  const mirroredPtyId = layout?.ptyIdsByLeafId?.[parsed.leafId]
  if (
    !run.terminalPtyId ||
    !terminals.hasTerminalTab(mirroredTabId) ||
    !layout?.root ||
    !mirroredPtyId ||
    !terminalLayoutContainsLeaf(layout.root, parsed.leafId) ||
    parseRemoteRuntimePtyId(mirroredPtyId)?.environmentId !== ownerEnvironmentId ||
    !(terminals.ptyIdsByTabId[mirroredTabId] ?? []).includes(mirroredPtyId)
  ) {
    return null
  }
  return {
    tabId: mirroredTabId,
    paneKey: makePaneKey(mirroredTabId, parsed.leafId),
    leafId: parsed.leafId,
    ptyId: mirroredPtyId
  }
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

/** The paired server that owns the run's workspace, or null when this client runs it itself. */
export function getAutomationRunOwnerEnvironmentId(
  state: WorktreeOperationRouteState,
  workspaceId: string | null | undefined,
  hostId?: ExecutionHostId
): string | null {
  if (!workspaceId) {
    return null
  }
  const owner = resolveOwner(state, { workspaceId, ...(hostId ? { hostId } : {}) })
  return owner.kind === 'resolved' && owner.owner.endpoint.kind === 'environment'
    ? owner.owner.endpoint.environmentId
    : null
}
