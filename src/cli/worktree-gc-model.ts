export const WORKTREE_GC_IDLE_MS = 24 * 60 * 60 * 1000
export const WORKTREE_GC_DEFAULT_IDLE_TERM_MIN = 60
export const WORKTREE_GC_BUSY_MARKS = [
  'ctrl+c to stop',
  'Calling',
  'Thinking',
  'Running',
  'Waiting…',
  'Generating',
  'esc to interrupt'
] as const
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
  lastOutputAt: number | null
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
  lastOutputAt: number | null
}

export type WorktreeGcRuntime = {
  listWorktrees: () => Promise<{
    worktrees: WorktreeGcRuntimeWorktree[]
    truncated: boolean
  }>
  listTerminals: () => Promise<WorktreeGcRuntimeTerminal[]>
  readTerminalTail: (handle: string) => Promise<string>
  closeTerminal: (handle: string) => Promise<boolean>
  removeWorktree: (input: { id: string; hostId: string }) => Promise<boolean>
}
