import { describe, expect, it } from 'vitest'
import { planSidebarRows } from '../../../../shared/sidebar-list/sidebar-row-plan'
import { collapseRuntimeOwnerWorktrees } from '../../../../shared/sidebar-list/runtime-owner-worktrees'
import { makeWorktree, TEST_REPO } from '../../store/slices/worktrees-slice-test-fixtures'
import type { Worktree } from '../../../../shared/worktree/types'

const WT = 'repo1::/root/projects/company-coord'
const environments = [
  { id: 'pvelxc', runtimeId: 'pvelxc', lastUsedAt: 1 },
  { id: 'accept', runtimeId: 'pvelxc', lastUsedAt: 2 },
  { id: 'msi', runtimeId: 'msi' }
]
function row(environmentId: string, id = WT) {
  return makeWorktree({
    id,
    repoId: 'repo1',
    hostId: `runtime:${environmentId}`,
    runtimeOwnerEnvironmentId: environmentId,
    isMainWorktree: true
  })
}
function plan(worktrees: Worktree[]) {
  return planSidebarRows({
    groupBy: 'repo',
    runtimeEnvironments: environments,
    worktrees,
    repoMap: new Map([['repo1', TEST_REPO]]),
    prGroupOf: () => 'in-progress',
    workspaceStatuses: [],
    projectOrderBy: 'manual',
    lineageById: {},
    worktreeMap: new Map(worktrees.map((entry) => [entry.id, entry])),
    nestLineage: false,
    projectGroups: [],
    placeholderRepoIds: new Set(),
    importedWorktreesByRepo: new Map(),
    newExternalWorktreesInboxByRepo: new Map(),
    pendingCreations: [],
    folderWorkspaces: [],
    defaultHostId: 'local',
    pinnedDisplayPolicy: 'single-location',
    filterRepoIds: [],
    hostLabelById: new Map([
      ['runtime:pvelxc', 'pvelxc'],
      ['runtime:accept', 'pvelxc-accept-1022']
    ])
  }).render(new Set())
}

describe('sidebar saved environment aliases', () => {
  it('renders one primary main for one runtime without deleting saved environments', () => {
    const worktrees = [row('pvelxc'), row('accept')]
    const rows = plan(worktrees)
    const items = rows.filter((entry) => entry.type === 'item')
    expect(items).toHaveLength(1)
    expect(items[0]?.worktree).toBe(worktrees[1])
    expect(environments).toHaveLength(3)
    expect(worktrees).toHaveLength(2)
  })

  it('keeps the same path on MSI separate', () => {
    expect(
      plan([row('pvelxc'), row('accept'), row('msi')]).filter((entry) => entry.type === 'item')
    ).toHaveLength(2)
  })

  it('keeps distinct folder workspace UUID suffixes separate', () => {
    expect(
      collapseRuntimeOwnerWorktrees(
        [
          row('pvelxc', `${WT}::workspace:123e4567-e89b-12d3-a456-426614174000`),
          row('accept', `${WT}::workspace:123e4567-e89b-12d3-a456-426614174001`)
        ],
        environments
      )
    ).toHaveLength(2)
  })

  it('does not collapse same-path SSH workspaces on different execution hosts', () => {
    expect(
      collapseRuntimeOwnerWorktrees(
        [
          { ...row('pvelxc'), hostId: 'ssh:one' },
          { ...row('accept'), hostId: 'ssh:two' }
        ],
        environments
      )
    ).toHaveLength(2)
  })
})
