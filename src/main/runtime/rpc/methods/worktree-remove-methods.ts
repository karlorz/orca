import { getLocalWorktreeCatalogVersion } from '../../../local-worktree-scan-generation'
import { getExplicitWorktreeIdSelector } from '../../runtime-worktree-selection'
import { splitWorktreeId } from '../../../../shared/worktree/id'
import { WorktreeGcRemove, WorktreeRemove } from '../../../../shared/rpc-contract/worktree-params'
import { listLocalProcessCwds } from '../../../../shared/worktree-gc-process-cwd'
import { defineMethod, type RpcContext } from '../core'
import { resolvePairedCallerHostId } from './paired-caller-host-id'
import { readsWorktreeRemovalMarker } from '../worktree-removal-marker-projection'
import type { z } from 'zod'

async function removeWorktreeFromRpc(
  params: z.infer<typeof WorktreeRemove> & Partial<z.infer<typeof WorktreeGcRemove>>,
  context: RpcContext
): Promise<Record<string, unknown>> {
  const { runtime } = context
  let resolvedHostId = resolvePairedCallerHostId(
    () => runtime.listRepos(),
    params.worktree,
    params.hostId
  )
  if (!resolvedHostId) {
    try {
      resolvedHostId = (await runtime.showManagedWorktree(params.worktree)).hostId
      if (!resolvedHostId) {
        throw new Error('worktree.rm could not resolve the workspace host')
      }
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'selector_not_found') {
        throw error
      }
    }
  }
  const explicitWorktreeId = getExplicitWorktreeIdSelector(params.worktree)
  const repoId = explicitWorktreeId ? splitWorktreeId(explicitWorktreeId)?.repoId : undefined
  const gcExaminedPath = params.gcExaminedPath
  const gcExaminedBranch = params.gcExaminedBranch
  const gcExaminedHead = params.gcExaminedHead
  const result = await runtime.removeManagedWorktree(params.worktree, {
    force: params.force === true,
    runHooks: params.runHooks === true,
    allowUnverifiedPtyStop: params.allowUnverifiedPtyStop === true,
    allowFailedArchiveHook: params.allowFailedArchiveHook === true,
    ...(resolvedHostId ? { hostId: resolvedHostId } : {}),
    ...(readsWorktreeRemovalMarker(context) ? { waitForBackgroundRemoval: true } : {}),
    ...(gcExaminedPath && gcExaminedBranch && gcExaminedHead
      ? {
          gcAcceptance: {
            examined: {
              path: gcExaminedPath,
              branch: gcExaminedBranch,
              head: gcExaminedHead
            },
            readAttached: async () => {
              const listed = await runtime.listTerminals(undefined, undefined, {
                includeVisualLayouts: false
              })
              return listed.terminals.some(
                (terminal) =>
                  terminal.worktreePath === gcExaminedPath ||
                  (explicitWorktreeId !== null && terminal.worktreeId === explicitWorktreeId)
              )
            },
            readProcessCwds: listLocalProcessCwds
          }
        }
      : {})
  })
  return {
    removed: true,
    ...result,
    ...(repoId ? { catalogVersion: getLocalWorktreeCatalogVersion(repoId) } : {})
  }
}

export const WORKTREE_REMOVE_METHODS = [
  defineMethod({
    name: 'worktree.rm',
    permission: 'workspace',
    params: WorktreeRemove,
    handler: async (params, context) => removeWorktreeFromRpc(params, context)
  }),
  defineMethod({
    name: 'worktree.gcRm',
    permission: 'workspace',
    params: WorktreeGcRemove,
    handler: async (params, context) => removeWorktreeFromRpc(params, context)
  })
]
