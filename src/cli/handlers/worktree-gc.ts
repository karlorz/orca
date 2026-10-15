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
import { WORKTREE_GC_DEFAULT_IDLE_TERM_MIN, type WorktreeGcRuntime } from '../worktree-gc-model'
import { listLocalProcessCwds } from '../worktree-gc-process-cwd'
import { formatWorktreeGcReport, runWorktreeGc } from '../worktree-gc-run'

function createWorktreeGcRuntime(client: RuntimeClient, repo?: string): WorktreeGcRuntime {
  const listWorktrees = async () => {
    const result = await client.call<RuntimeWorktreeListResult>('worktree.list', {
      ...(repo ? { repo } : {}),
      limit: 10_000
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
        includeVisualLayouts: false
      })
      const listed = repo ? await listWorktrees() : null
      const paths = new Set((listed?.worktrees ?? []).map((worktree) => worktree.path))
      const ids = new Set((listed?.worktrees ?? []).map((worktree) => worktree.id))
      return result.result.terminals
        .filter(
          (terminal) =>
            listed === null || paths.has(terminal.worktreePath) || ids.has(terminal.worktreeId)
        )
        .map((terminal) => ({
          handle: terminal.handle,
          title: terminal.title,
          worktreePath: terminal.worktreePath,
          lastOutputAt: terminal.lastOutputAt
        }))
    },
    async readTerminalTail(handle) {
      const result = await client.call<{ terminal: RuntimeTerminalRead }>('terminal.read', {
        terminal: handle,
        limit: 10
      })
      return result.result.terminal.tail.join('\n')
    },
    async closeTerminal(handle) {
      const result = await client.call<{ close: RuntimeTerminalClose }>('terminal.close', {
        terminal: handle
      })
      return Boolean(result.result.close.handle)
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
