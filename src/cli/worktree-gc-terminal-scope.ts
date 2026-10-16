import { LOCAL_EXECUTION_HOST_ID } from '../shared/execution-host'
import { hostScopeCensusIsComplete } from '../shared/runtime-listing-host-scope'
import type { RuntimeTerminalListResult } from '../shared/runtime-types'
import type {
  WorktreeGcRuntimeTerminal,
  WorktreeGcRuntimeWorktree,
  WorktreeGcTerminalList
} from './worktree-gc-model'

export function completeGcTerminalList(
  terminals: WorktreeGcRuntimeTerminal[] = [],
  overrides: Partial<WorktreeGcTerminalList> = {}
): WorktreeGcTerminalList {
  return {
    terminals,
    truncated: false,
    totalCount: terminals.length,
    hostScope: { hostIds: [LOCAL_EXECUTION_HOST_ID], omittedHostIds: [] },
    ...overrides
  }
}

export function terminalInventoryIsComplete(list: WorktreeGcTerminalList): boolean {
  if (list.inventoryComplete !== undefined) {
    return list.inventoryComplete
  }
  if (list.truncated || list.totalCount > list.terminals.length) {
    return false
  }
  return hostScopeCensusIsComplete(list.hostScope)
}

export function terminalMatchesSelectedWorktree(
  terminal: WorktreeGcRuntimeTerminal,
  worktree: WorktreeGcRuntimeWorktree
): boolean {
  const terminalHost = terminal.executionHostId
  const worktreeHost = worktree.hostId
  if (!terminal.worktreeId || !terminalHost || !worktreeHost) {
    return false
  }
  return terminal.worktreeId === worktree.id && terminalHost === worktreeHost
}

export function filterTerminalsForSelectedWorktrees(
  terminals: WorktreeGcRuntimeTerminal[],
  worktrees: WorktreeGcRuntimeWorktree[]
): WorktreeGcRuntimeTerminal[] {
  return terminals.filter((terminal) =>
    worktrees.some((worktree) => terminalMatchesSelectedWorktree(terminal, worktree))
  )
}

export function attachedPathsFromTerminals(terminals: { worktreePath: string }[]): Set<string> {
  return new Set(
    terminals.map((terminal) => terminal.worktreePath).filter((entry) => entry.length > 0)
  )
}

export function mapRuntimeTerminalList(
  result: RuntimeTerminalListResult,
  repoWorktrees: WorktreeGcRuntimeWorktree[] | null
): WorktreeGcTerminalList {
  const mapped = result.terminals.map((terminal) => ({
    handle: terminal.handle,
    title: terminal.title,
    worktreePath: terminal.worktreePath,
    worktreeId: terminal.worktreeId,
    lastOutputAt: terminal.lastOutputAt,
    incarnationId: terminal.incarnationId,
    executionHostId: terminal.executionHostId
  }))
  const unfiltered: WorktreeGcTerminalList = {
    terminals: mapped,
    truncated: result.truncated,
    totalCount: result.totalCount,
    hostScope: result.hostScope
  }
  return {
    terminals: repoWorktrees ? filterTerminalsForSelectedWorktrees(mapped, repoWorktrees) : mapped,
    truncated: result.truncated,
    totalCount: result.totalCount,
    hostScope: result.hostScope,
    inventoryComplete: terminalInventoryIsComplete(unfiltered)
  }
}
