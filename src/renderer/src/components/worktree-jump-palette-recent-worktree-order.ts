import { getPaletteWorktreeIdentity } from '@/lib/palette-repo-resolution'
import {
  maxValidPaletteActivityTimestamp,
  preparePaletteActivity,
  type PaletteSearchContext
} from '@/lib/palette-match/palette-ranking'
import { getWorktreeVisitTimestamp } from '@/lib/worktree-visit-recency'
import { compareWorktreeDisplayName } from '@/lib/worktree-display-name-order'
import type { Worktree } from '../../../shared/worktree/types'
import type { ExecutionHostId } from '../../../shared/execution-host'
import type { OpenTabPaletteItem, WorktreePaletteItem } from './worktree-jump-palette-model'

export function orderRecentPaletteWorktrees({
  items,
  openTabItems,
  resolveWorktree,
  lastVisitedAtByWorktreeId,
  context
}: {
  items: readonly WorktreePaletteItem[]
  openTabItems: readonly {
    result: Pick<OpenTabPaletteItem['result'], 'worktreeId' | 'executionHostId' | 'lastActiveAt'>
  }[]
  resolveWorktree: (worktreeId: string, hostId: ExecutionHostId | undefined) => Worktree | undefined
  lastVisitedAtByWorktreeId: Record<string, number>
  context: PaletteSearchContext
}): WorktreePaletteItem[] {
  const tabActivityByWorktree = new Map<string, number>()
  for (const item of openTabItems) {
    const activeAt = item.result.lastActiveAt
    if (!activeAt || !Number.isFinite(activeAt) || activeAt <= 0) {
      continue
    }
    const worktree = resolveWorktree(item.result.worktreeId, item.result.executionHostId)
    if (!worktree) {
      continue
    }
    const identity = getPaletteWorktreeIdentity(worktree)
    tabActivityByWorktree.set(
      identity,
      Math.max(tabActivityByWorktree.get(identity) ?? 0, activeAt)
    )
  }
  return items
    .map((item) => {
      const lastActiveAt = maxValidPaletteActivityTimestamp([
        item.worktree.lastActivityAt,
        getWorktreeVisitTimestamp(lastVisitedAtByWorktreeId, item.worktree),
        tabActivityByWorktree.get(getPaletteWorktreeIdentity(item.worktree))
      ])
      const activity = preparePaletteActivity(lastActiveAt, context)
      return {
        ...item,
        match: { ...item.match, lastActiveAt: activity.timestamp || null, activity }
      }
    })
    .sort(
      (left, right) =>
        right.match.activity.timestamp - left.match.activity.timestamp ||
        compareWorktreeDisplayName(left.worktree, right.worktree)
    )
}
