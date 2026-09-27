import type { ExecutionHostId } from '../../../shared/execution-host'
import type { Worktree } from '../../../shared/worktree/types'
import { isPaletteCurrentWorktree } from './palette-repo-resolution'

export type SelectEmptyQueryInputs = {
  visibleWorktrees: readonly Worktree[]
  activeWorktreeId: string | null
  /** Host of the active workspace. Omit to fall back to bare-id matching (STA-4343). */
  activeWorkspaceExecutionHostId?: ExecutionHostId | null
}

export type SelectEmptyQueryResult = {
  /** Full visible list (including current). Drives "has any worktrees"
   *  / loading / empty-state decisions so the palette never claims to be
   *  empty just because the only visible worktree is the current one. */
  visibleWorktreesForState: readonly Worktree[]
  /** Switchable rows for the Worktrees section — current worktree excluded.
   *  Activity ordering happens when palette items are built. */
  switchableWorktreesForRows: Worktree[]
}

/**
 * The current worktree is excluded from rows but kept in
 * visibleWorktreesForState so empty-state logic isn't affected.
 */
export function selectEmptyQueryWorktrees(inputs: SelectEmptyQueryInputs): SelectEmptyQueryResult {
  const { visibleWorktrees, activeWorktreeId, activeWorkspaceExecutionHostId } = inputs
  // Why the host too (STA-4343): `repoId::path` repeats across hosts, so filtering on the
  // bare id drops BOTH same-id rows as "current" and the other host becomes unreachable.
  const switchableWorktreesForRows = visibleWorktrees.filter(
    (w) => !isPaletteCurrentWorktree(w, activeWorktreeId, activeWorkspaceExecutionHostId)
  )
  return {
    visibleWorktreesForState: visibleWorktrees,
    switchableWorktreesForRows
  }
}
