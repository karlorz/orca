import type { RuntimeListingHostScope } from '../shared/runtime-listing-host-scope'
import { WORKTREE_GC_BUSY_MARKS as SHARED_WORKTREE_GC_BUSY_MARKS } from '../shared/worktree-gc-terminal-idle'

export const WORKTREE_GC_LIST_LIMIT = 10_000
export const WORKTREE_GC_IDLE_MS = 24 * 60 * 60 * 1000
export const WORKTREE_GC_DEFAULT_IDLE_TERM_MIN = 60
export const WORKTREE_GC_BUSY_MARKS = SHARED_WORKTREE_GC_BUSY_MARKS
export const WORKTREE_GC_ORPHAN_REASON = 'ORPHAN(metadata gone; cannot prove clean; review by hand)'

export type WorktreeGcGitResult = {
  code: number
  stdout: string
  stderr: string
}

export type WorktreeGcGitRunner = (
  cwd: string,
  args: readonly string[]
) => Promise<WorktreeGcGitResult>

export type WorktreeGcPrLookup = (
  cwd: string,
  branch: string
) => Promise<{ ok: boolean; states: readonly string[] }>

export type WorktreeGcProcessCwdScan =
  | { verdict: 'live'; cwds: readonly string[] }
  | { verdict: 'unverifiable' }

export type WorktreeGcTerminalAction = 'keep' | 'close'
export type WorktreeGcWorktreeAction = 'keep' | 'remove' | 'prune'

export type WorktreeGcTerminalRecord = {
  handle: string
  title: string
  worktreePath: string
  worktreeId?: string
  lastOutputAt: number | null
  incarnationId?: string | null
  executionHostId?: string
  action: WorktreeGcTerminalAction
  why: string
  ok?: boolean
}

export type WorktreeGcOrcaMeta = {
  id?: string
  hostId?: string
  lastActivityAt?: number
}

export type WorktreeGcWorktreeRecord = {
  path: string
  branch: string
  head: string
  repo: string
  orcaId?: string
  hostId?: string
  reasons: string[]
  action: WorktreeGcWorktreeAction
  ok?: boolean
}

export type WorktreeGcReport = {
  ts: string
  apply: boolean
  coord: string | null
  journalPath: string
  terminals: WorktreeGcTerminalRecord[]
  worktrees: WorktreeGcWorktreeRecord[]
}

export type WorktreeGcRuntimeWorktree = {
  id: string
  path: string
  hostId?: string
  lastActivityAt?: number
  isMainWorktree?: boolean
}

export type WorktreeGcRuntimeTerminal = {
  handle: string
  title: string | null
  worktreePath: string
  worktreeId?: string
  lastOutputAt: number | null
  incarnationId?: string | null
  executionHostId?: string
}

export type WorktreeGcTerminalList = {
  terminals: WorktreeGcRuntimeTerminal[]
  truncated: boolean
  totalCount: number
  hostScope?: RuntimeListingHostScope
  inventoryComplete?: boolean
}

export type WorktreeGcRuntime = {
  listWorktrees: () => Promise<{
    worktrees: WorktreeGcRuntimeWorktree[]
    truncated: boolean
  }>
  listTerminals: () => Promise<WorktreeGcTerminalList>
  readTerminalTail: (handle: string) => Promise<string>
  closeTerminal: (
    handle: string,
    expectedIncarnationId?: string | null,
    idleTermMin?: number,
    coordHandle?: string | null
  ) => Promise<boolean>
  removeWorktree: (input: {
    id: string
    hostId: string
    examinedPath: string
    examinedBranch: string
    examinedHead: string
  }) => Promise<boolean>
}
