import { parseExecutionHostId, toRuntimeExecutionHostId } from '../../../shared/execution-host'
import type { ExecutionHostId } from '../../../shared/execution-host'
import { preferredRuntimeOwnerEnvironmentIds } from '../../../shared/runtime-environment-owner'
import type {
  RuntimeOwnerEnvironment,
  RuntimeOwnerStatus
} from '../../../shared/runtime-environment-owner'
import type { WorktreeOperationRouteState } from './worktree-operation-route'

const catalogIndexes = new WeakMap<
  readonly RuntimeOwnerEnvironment[],
  {
    statuses: WorktreeOperationRouteState['runtimeStatusByEnvironmentId']
    aliases: ReadonlyMap<string, string>
    slices: WeakMap<object, object>
  }
>()

export function runtimeOwnerRouteState(
  state: WorktreeOperationRouteState
): WorktreeOperationRouteState {
  const environments = state.runtimeEnvironments
  if (!environments) {
    return state
  }
  let index = catalogIndexes.get(environments)
  if (!index || index.statuses !== state.runtimeStatusByEnvironmentId) {
    const aliases = preferredRuntimeOwnerEnvironmentIds(
      environments,
      state.runtimeStatusByEnvironmentId
    )
    const previous = index
    const slices =
      previous && [...aliases].every(([id, preferred]) => previous.aliases.get(id) === preferred)
        ? previous.slices
        : new WeakMap<object, object>()
    index = {
      statuses: state.runtimeStatusByEnvironmentId,
      aliases,
      slices
    }
    catalogIndexes.set(environments, index)
  }
  const { aliases, slices } = index
  if (![...aliases].some(([id, preferred]) => id !== preferred)) {
    return state
  }
  function host(id: ExecutionHostId | null | undefined): ExecutionHostId | null | undefined
  function host(id: string | null | undefined): string | null | undefined
  function host(id: string | null | undefined): string | null | undefined {
    const parsed = parseExecutionHostId(id)
    return parsed?.kind === 'runtime'
      ? toRuntimeExecutionHostId(aliases.get(parsed.environmentId) ?? parsed.environmentId)
      : id
  }
  const row = <
    T extends {
      executionHostId?: string | null
      hostId?: ExecutionHostId
      runtimeOwnerEnvironmentId?: string
    }
  >(
    value: T
  ): T => ({
    ...value,
    ...('executionHostId' in value ? { executionHostId: host(value.executionHostId) } : {}),
    ...('hostId' in value ? { hostId: host(value.hostId) ?? undefined } : {}),
    ...(value.runtimeOwnerEnvironmentId
      ? {
          runtimeOwnerEnvironmentId:
            aliases.get(value.runtimeOwnerEnvironmentId) ?? value.runtimeOwnerEnvironmentId
        }
      : {})
  })
  function mapped<T extends object>(
    source: T | undefined,
    transform: (value: T) => T
  ): T | undefined {
    if (!source) {
      return source
    }
    const cached = slices.get(source)
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: each immutable slice is cached with its own shape-preserving transform.
    if (cached) {
      return cached as T
    }
    const next = transform(source)
    slices.set(source, next)
    return next
  }
  return {
    ...state,
    repos: mapped(state.repos, (rows) => rows.map(row)),
    folderWorkspaces: mapped(state.folderWorkspaces, (rows) => rows.map(row)),
    projectGroups: mapped(state.projectGroups, (rows) => rows.map(row)),
    worktreesByRepo: mapped(state.worktreesByRepo, (groups) =>
      Object.fromEntries(Object.entries(groups).map(([id, rows]) => [id, rows.map(row)]))
    ),
    detectedWorktreesByRepo: mapped(state.detectedWorktreesByRepo, (groups) =>
      Object.fromEntries(
        Object.entries(groups).map(([id, listing]) => [
          id,
          { ...listing, worktrees: listing.worktrees.map(row) }
        ])
      )
    ),
    activeWorkspaceExecutionHostId: host(state.activeWorkspaceExecutionHostId)
  }
}

export function runtimeOwnerRouteHost(
  state: {
    runtimeEnvironments?: readonly RuntimeOwnerEnvironment[]
    runtimeStatusByEnvironmentId?: ReadonlyMap<string, RuntimeOwnerStatus>
  },
  hostId: ExecutionHostId
): ExecutionHostId {
  const host = parseExecutionHostId(hostId)
  if (host?.kind !== 'runtime' || !state.runtimeEnvironments) {
    return hostId
  }
  const aliases = preferredRuntimeOwnerEnvironmentIds(
    state.runtimeEnvironments,
    state.runtimeStatusByEnvironmentId
  )
  return toRuntimeExecutionHostId(aliases.get(host.environmentId) ?? host.environmentId)
}
