import { makeWorktree } from '../store/slices/worktrees-slice-test-fixtures'
import { describe, expect, it, vi } from 'vitest'
import { resolveOwner } from './resolve-owner'
import {
  resolveWorktreeOperationRouteResult,
  resolveWorktreeOperationRouteResultForHost,
  type WorktreeOperationRouteState
} from './worktree-operation-route'
import { getFileExplorerOperationOwnerFromState } from '../components/right-sidebar/file-explorer-operation-owner'
import { canonicalRuntimeOwnerKey } from '../../../shared/runtime-environment-owner'

vi.mock('@/store', () => ({ useAppStore: { getState: vi.fn() } }))
const WT = 'repo::/root/projects/company-coord'
const environments = [
  { id: 'pvelxc', runtimeId: 'runtime-pvelxc', lastUsedAt: 1 },
  { id: 'accept', runtimeId: 'runtime-pvelxc', lastUsedAt: 2 },
  { id: 'msi', runtimeId: 'runtime-msi', lastUsedAt: 3 }
]
function state(otherRuntime = 'runtime-pvelxc'): WorktreeOperationRouteState {
  return {
    runtimeEnvironments: environments.map((row) =>
      row.id === 'accept' ? { ...row, runtimeId: otherRuntime } : row
    ),
    repos: ['pvelxc', 'accept'].map((id) => ({
      id: 'repo',
      executionHostId: `runtime:${id}` as const
    })),
    worktreesByRepo: {
      repo: ['pvelxc', 'accept'].map((id) => ({
        id: WT,
        repoId: 'repo',
        hostId: `runtime:${id}` as const,
        runtimeOwnerEnvironmentId: id
      }))
    }
  }
}

describe('saved environment aliases', () => {
  it('uses runtime identity with a saved-id fallback', () => {
    expect(canonicalRuntimeOwnerKey(' pvelxc ', environments)).toBe('runtime-pvelxc')
    expect(canonicalRuntimeOwnerKey('accept', environments)).toBe('runtime-pvelxc')
    expect(canonicalRuntimeOwnerKey('msi', environments)).toBe('runtime-msi')
    expect(canonicalRuntimeOwnerKey('legacy', environments)).toBe('legacy')
    expect(canonicalRuntimeOwnerKey(' ', environments)).toBeNull()
  })

  it('resolves alias publications through the most recently used environment', () => {
    expect(resolveOwner(state(), { workspaceId: WT })).toEqual({
      kind: 'resolved',
      owner: { endpoint: { kind: 'environment', environmentId: 'accept' }, at: 'local' }
    })
    expect(resolveWorktreeOperationRouteResult(state(), WT)).toEqual({
      kind: 'resolved',
      route: { executionHostId: 'runtime:accept', runtimeEnvironmentId: 'accept' }
    })
  })

  it('prefers a connected environment over the more recently used alias', () => {
    const rows = {
      ...state(),
      runtimeStatusByEnvironmentId: new Map([
        ['pvelxc', { snapshot: { transport: 'ready', verification: 'verified' } }]
      ])
    }
    expect(resolveOwner(rows, { workspaceId: WT })).toMatchObject({
      kind: 'resolved',
      owner: { endpoint: { environmentId: 'pvelxc' } }
    })
    expect(resolveWorktreeOperationRouteResultForHost(rows, WT, 'runtime:accept')).toMatchObject({
      kind: 'resolved',
      route: { runtimeEnvironmentId: 'pvelxc' }
    })
  })

  it('keeps different runtimes and local owners ambiguous', () => {
    expect(resolveOwner(state('runtime-msi'), { workspaceId: WT })).toEqual({ kind: 'ambiguous' })
    const rows = state()
    rows.worktreesByRepo = {
      repo: [...(rows.worktreesByRepo?.repo ?? []), { id: WT, repoId: 'repo', hostId: 'local' }]
    }
    expect(resolveOwner(rows, { workspaceId: WT })).toEqual({ kind: 'ambiguous' })
  })

  it('routes the file explorer to the runtime instead of unresolved', () => {
    const rows = state()
    const owner = getFileExplorerOperationOwnerFromState(
      {
        ...rows,
        settings: null,
        repos: [],
        worktreesByRepo: {
          repo: (rows.worktreesByRepo?.repo ?? []).map((row) => makeWorktree(row))
        },
        detectedWorktreesByRepo: {},
        folderWorkspaces: [],
        projectGroups: [],
        restoredRuntimeHostIdByWorkspaceSessionKey: {}
      },
      WT
    )
    expect(owner).toEqual({
      kind: 'runtime',
      environmentId: 'accept',
      executionHostId: 'runtime:accept'
    })
  })

  it('resolves aliases for the same folder id without merging distinct folders', () => {
    const rows = {
      ...state(),
      folderWorkspaces: ['pvelxc', 'accept'].map((id) => ({
        id: 'f1',
        projectGroupId: 'g',
        executionHostId: `runtime:${id}` as const
      }))
    }
    expect(resolveOwner(rows, { workspaceId: 'folder:f1' })).toMatchObject({
      kind: 'resolved',
      owner: { endpoint: { environmentId: 'accept' } }
    })
    expect(resolveOwner(rows, { workspaceId: 'folder:f2' })).toEqual({ kind: 'missing' })
  })
})
