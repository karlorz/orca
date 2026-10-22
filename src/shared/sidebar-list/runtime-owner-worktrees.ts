import { parseExecutionHostId } from '../execution-host'
import {
  canonicalRuntimeOwnerKey,
  preferredRuntimeOwnerEnvironmentIds
} from '../runtime-environment-owner'
import type { RuntimeOwnerEnvironment, RuntimeOwnerStatus } from '../runtime-environment-owner'
import { worktreeIdentityKey } from '../worktree/id'
import type { Worktree } from '../worktree/types'

export function collapseRuntimeOwnerWorktrees(
  worktrees: readonly Worktree[],
  environments: readonly RuntimeOwnerEnvironment[],
  statuses?: ReadonlyMap<string, RuntimeOwnerStatus>
): Worktree[] {
  const preferred = preferredRuntimeOwnerEnvironmentIds(environments, statuses)
  const rows = new Map<string, Worktree>()
  for (const worktree of worktrees) {
    const host = parseExecutionHostId(worktree.hostId)
    const environmentId =
      worktree.runtimeOwnerEnvironmentId || (host?.kind === 'runtime' ? host.environmentId : null)
    const key = JSON.stringify([
      worktreeIdentityKey(worktree.id),
      environmentId ? canonicalRuntimeOwnerKey(environmentId, environments) : null,
      host?.kind === 'runtime' ? 'runtime' : (worktree.hostId ?? null)
    ])
    const existing = rows.get(key)
    const existingHost = parseExecutionHostId(existing?.hostId)
    const existingEnvironmentId =
      existing?.runtimeOwnerEnvironmentId ||
      (existingHost?.kind === 'runtime' ? existingHost.environmentId : null)
    if (
      !existing ||
      (environmentId &&
        environmentId !== existingEnvironmentId &&
        preferred.get(environmentId) === environmentId)
    ) {
      rows.set(key, worktree)
    }
  }
  return [...rows.values()]
}
