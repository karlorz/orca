import path from 'node:path'
import type {
  RuntimeTerminalClose,
  RuntimeTerminalListResult,
  RuntimeTerminalRead,
  RuntimeWorktreeListResult,
  RuntimeWorktreeRemoveResult
} from '../../shared/runtime-types'
import type { CommandHandler } from '../dispatch'
import { getOptionalPositiveIntegerFlag, getOptionalStringFlag } from '../flags'
import { printResult } from '../format'
import { RuntimeClientError, type RuntimeClient } from '../runtime-client'
import { getDefaultUserDataPath } from '../runtime/metadata'
import { lookupGithubPrStates } from '../worktree-gc-github'
import {
  WORKTREE_GC_DEFAULT_IDLE_TERM_MIN,
  WORKTREE_GC_LIST_LIMIT,
  type WorktreeGcRuntime
} from '../worktree-gc-model'
import { listLocalProcessCwds } from '../worktree-gc-process-cwd'
import { formatWorktreeGcReport, runWorktreeGc } from '../worktree-gc-run'
import { mapRuntimeTerminalList } from '../worktree-gc-terminal-scope'

function createWorktreeGcRuntime(client: RuntimeClient, repo?: string): WorktreeGcRuntime {
  const listWorktrees = async () => {
    const result = await client.call<RuntimeWorktreeListResult>('worktree.list', {
      ...(repo ? { repo } : {}),
      limit: WORKTREE_GC_LIST_LIMIT
    })
    return {
      worktrees: result.result.worktrees.map((worktree) => ({
        id: worktree.id,
        path: worktree.path,
        hostId: worktree.hostId,
        lastActivityAt: worktree.lastActivityAt,
        isMainWorktree: worktree.isMainWorktree
      })),
      truncated: result.result.truncated
    }
  }
  return {
    listWorktrees,
    async listTerminals() {
      const result = await client.call<RuntimeTerminalListResult>('terminal.list', {
        includeVisualLayouts: false,
        limit: WORKTREE_GC_LIST_LIMIT
      })
      const listed = repo ? await listWorktrees() : null
      return mapRuntimeTerminalList(result.result, listed?.worktrees ?? null)
    },
    async readTerminalTail(handle) {
      const result = await client.call<{ terminal: RuntimeTerminalRead }>('terminal.read', {
        terminal: handle,
        limit: 10
      })
      return result.result.terminal.tail.join('\n')
    },
    async closeTerminal(handle, expectedIncarnationId, idleTermMin, coordHandle) {
      try {
        const result = await client.call<{ close: RuntimeTerminalClose }>('terminal.gcClose', {
          terminal: handle,
          ...(expectedIncarnationId ? { expectedIncarnationId } : {}),
          ...(typeof idleTermMin === 'number' ? { gcIdleTermMin: idleTermMin } : {}),
          ...(coordHandle ? { gcCoordHandle: coordHandle } : {})
        })
        return Boolean(result.result.close.handle)
      } catch (error) {
        if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
          return false
        }
        throw error
      }
    },
    async removeWorktree(input) {
      const result = await client.call<RuntimeWorktreeRemoveResult>('worktree.rm', {
        worktree: `id:${input.id}`,
        hostId: input.hostId,
        force: false,
        allowUnverifiedPtyStop: false
      })
      return result.result.removed === true
    }
  }
}

function coordHandleFromFlags(flags: Map<string, string | boolean>): string | null {
  const explicit = getOptionalStringFlag(flags, 'coord-terminal')
  if (explicit) {
    return explicit
  }
  const envHandle = process.env.ORCA_TERMINAL_HANDLE
  return typeof envHandle === 'string' && envHandle.length > 0 ? envHandle : null
}

export const WORKTREE_GC_HANDLERS: Record<string, CommandHandler> = {
  'worktree gc': async ({ flags, client, json }) => {
    if (flags.get('force') === true) {
      throw new RuntimeClientError(
        'invalid_argument',
        'orca worktree gc never uses --force. Pass --apply to act, or omit it for a dry-run.'
      )
    }
    if (client.isRemote) {
      throw new RuntimeClientError(
        'invalid_environment',
        'orca worktree gc refuses a remote runtime. Run it on the execution host that owns the worktrees.'
      )
    }
    const report = await runWorktreeGc({
      apply: flags.get('apply') === true,
      nowMs: Date.now(),
      idleTermMin:
        getOptionalPositiveIntegerFlag(flags, 'idle-term-min') ?? WORKTREE_GC_DEFAULT_IDLE_TERM_MIN,
      coordHandle: coordHandleFromFlags(flags),
      journalDir:
        getOptionalStringFlag(flags, 'journal-dir') ??
        path.join(getDefaultUserDataPath(), 'worktree-gc'),
      runtime: createWorktreeGcRuntime(client, getOptionalStringFlag(flags, 'repo')),
      listPrStates: lookupGithubPrStates,
      listProcessCwds: listLocalProcessCwds
    })
    printResult(
      { id: 'worktree.gc', ok: true, result: report, _meta: { runtimeId: 'local' } },
      json,
      formatWorktreeGcReport
    )
  }
}
