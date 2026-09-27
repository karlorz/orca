import { describe, expect, it } from 'vitest'
import type { Worktree } from '../../../shared/worktree/types'
import { selectEmptyQueryWorktrees } from './select-empty-query-worktrees'

function wt(id: string, hostId?: Worktree['hostId']): Worktree {
  return {
    id,
    hostId,
    repoId: 'repo-1',
    path: `/tmp/${id}`,
    head: 'abc',
    branch: `refs/heads/${id}`,
    isBare: false,
    isMainWorktree: false,
    displayName: id,
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 0
  }
}

describe('selectEmptyQueryWorktrees', () => {
  it('keeps the current worktree in state while excluding it from switchable rows', () => {
    const current = wt('current')
    const other = wt('other')
    const result = selectEmptyQueryWorktrees({
      visibleWorktrees: [current, other],
      activeWorktreeId: 'current'
    })
    expect(result.visibleWorktreesForState).toEqual([current, other])
    expect(result.switchableWorktreesForRows).toEqual([other])
  })

  it('keeps the same-id worktree on another host switchable', () => {
    const local = wt('same', 'local')
    const ssh = wt('same', 'ssh:box')
    const result = selectEmptyQueryWorktrees({
      visibleWorktrees: [local, ssh],
      activeWorktreeId: 'same',
      activeWorkspaceExecutionHostId: 'local'
    })
    expect(result.switchableWorktreesForRows).toEqual([ssh])
  })

  it('preserves source order for the final activity sort', () => {
    const worktrees = [wt('b'), wt('a')]
    const result = selectEmptyQueryWorktrees({
      visibleWorktrees: worktrees,
      activeWorktreeId: null
    })
    expect(result.switchableWorktreesForRows).toEqual(worktrees)
  })
})
