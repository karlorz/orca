import { describe, expect, it } from 'vitest'
import { createPaletteSearchContext } from '@/lib/palette-match/palette-ranking'
import { makeEmptyPaletteSearchResult } from '@/lib/worktree-palette-search'
import { buildPaletteWorktreeIndex, resolvePaletteWorktree } from '@/lib/palette-repo-resolution'
import { makeWorktree } from './worktree-jump-palette-test-fixtures'
import { orderRecentPaletteWorktrees } from './worktree-jump-palette-recent-worktree-order'

describe('orderRecentPaletteWorktrees', () => {
  it('attributes tab activity to the correct host when worktree ids collide', () => {
    const now = 10_000
    const local = makeWorktree('same', 'Local', { hostId: 'local', lastActivityAt: 100 })
    const ssh = makeWorktree('same', 'SSH', { hostId: 'ssh:box', lastActivityAt: 200 })
    const worktrees = [local, ssh]
    const index = buildPaletteWorktreeIndex(worktrees)
    const ordered = orderRecentPaletteWorktrees({
      items: worktrees.map((worktree) => ({
        id: worktree.hostId ?? '',
        type: 'worktree' as const,
        worktree,
        match: makeEmptyPaletteSearchResult(
          worktree.id,
          worktree.hostId,
          createPaletteSearchContext(now),
          worktree.lastActivityAt
        )
      })),
      openTabItems: [
        { result: { worktreeId: 'same', executionHostId: 'ssh:box', lastActiveAt: 8_000 } }
      ],
      resolveWorktree: (id, hostId) => resolvePaletteWorktree(index, id, hostId),
      lastVisitedAtByWorktreeId: {},
      context: createPaletteSearchContext(now)
    })

    expect(ordered.map((item) => [item.worktree.hostId, item.match.lastActiveAt])).toEqual([
      ['ssh:box', 8_000],
      ['local', 100]
    ])
  })
})
