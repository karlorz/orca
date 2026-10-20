import {
  getPtyIdsForHost,
  ptyIncarnationById,
  restorePtyIncarnation,
  setAdoptedPtyOwnership
} from '../provider/ownership-state'
import {
  getProvider,
  localProvider,
  registeredPtyProviders,
  resolvePtyExecutionHost
} from '../provider/registry'
import { LOCAL_EXECUTION_HOST_ID, type ExecutionHostId } from '../../../../shared/execution-host'
import { isPtyIncarnationId } from '../../../../shared/pty-incarnation'
import type { PtyProcessInfo } from '../../../providers/pty-process-info'
import type { PtyRuntimeControllerDeps } from './controller-deps'

type InventoryDeps = Pick<PtyRuntimeControllerDeps, 'runtime'>

async function listLocalProcesses(): Promise<PtyProcessInfo[]> {
  const provider = localProvider
  const processes = await provider.listProcesses()
  if (provider === localProvider) {
    for (const process of processes) {
      if (
        !process.exiting &&
        isPtyIncarnationId(process.incarnationId) &&
        !ptyIncarnationById.has(process.id) &&
        resolvePtyExecutionHost(process.id) === LOCAL_EXECUTION_HOST_ID
      ) {
        // Recovered daemon terminals need the same stop fence a fresh spawn records.
        setAdoptedPtyOwnership(process.id)
        restorePtyIncarnation(process.id, process.incarnationId)
      }
    }
  }
  return processes
}

function markSshInventoryUnverifiable(
  runtime: PtyRuntimeControllerDeps['runtime'],
  hostId: ExecutionHostId,
  error: unknown
): void {
  const reason = error instanceof Error ? error.message : String(error)
  for (const ptyId of getPtyIdsForHost(hostId)) {
    runtime?.markPtyLivenessUnverifiable?.(ptyId, reason)
  }
}

export async function listProcessesWithHostScopeFromRuntimeController(
  deps: InventoryDeps,
  opts?: { deadlineMs?: number; includeForegroundProcessEvidence?: boolean }
): Promise<{ processes: PtyProcessInfo[]; hostIds: ExecutionHostId[] }> {
  const providerSessions = await Promise.all(
    registeredPtyProviders().map(async ({ provider, hostId }) => {
      const isLocal = hostId === LOCAL_EXECUTION_HOST_ID
      try {
        return {
          processes: await (isLocal ? listLocalProcesses() : provider.listProcesses(opts)),
          hostId
        }
      } catch (error) {
        if (isLocal) {
          throw error
        }
        markSshInventoryUnverifiable(deps.runtime, hostId, error)
        return null
      }
    })
  )
  const respondingSessions = providerSessions.filter((session) => session !== null)
  return {
    processes: respondingSessions.flatMap((session) => session.processes),
    hostIds: respondingSessions.map((session) => session.hostId)
  }
}

export async function listProcessesFromRuntimeController(
  deps: InventoryDeps,
  hostId?: ExecutionHostId,
  opts?: { deadlineMs?: number; includeForegroundProcessEvidence?: boolean }
) {
  if (hostId === LOCAL_EXECUTION_HOST_ID) {
    return listLocalProcesses()
  }
  if (hostId !== undefined) {
    try {
      return await getProvider(hostId).listProcesses(opts)
    } catch (error) {
      markSshInventoryUnverifiable(deps.runtime, hostId, error)
      throw error
    }
  }
  return (await listProcessesWithHostScopeFromRuntimeController(deps, opts)).processes
}
