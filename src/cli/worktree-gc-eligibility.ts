import { lstat, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { isPathInsideOrEqual } from '../shared/cross-platform-path'
import { LOCAL_EXECUTION_HOST_ID } from '../shared/execution-host'
import { parseGitdirMarkerPayload } from '../shared/gitdir-marker-payload'
import type { GitWorktreeInfo } from '../shared/worktree/types'
import { classifyGcTerminalIdle, isWorktreeGcBusyTail } from '../shared/worktree-gc-terminal-idle'
import { newestGitActivityMs } from './worktree-gc-git-activity'
import {
  countUnpushedCommits,
  isMergedIntoDefault,
  readGitBranch,
  readGitHead,
  readGitStatusPorcelain,
  shortBranchName
} from './worktree-gc-git'
import {
  WORKTREE_GC_IDLE_MS,
  WORKTREE_GC_ORPHAN_REASON,
  type WorktreeGcGitRunner,
  type WorktreeGcOrcaMeta,
  type WorktreeGcPrLookup,
  type WorktreeGcProcessCwdScan,
  type WorktreeGcTerminalRecord,
  type WorktreeGcWorktreeRecord
} from './worktree-gc-model'

export { isWorktreeGcBusyTail }

export function classifyGcTerminal(input: {
  handle: string
  title: string | null
  worktreePath: string
  lastOutputAt: number | null
  tail: string
  nowMs: number
  idleTermMin: number
  coordHandle: string | null
}): WorktreeGcTerminalRecord {
  const title = (input.title ?? '').slice(0, 50)
  const idle = classifyGcTerminalIdle({
    lastOutputAt: input.lastOutputAt,
    tail: input.tail,
    nowMs: input.nowMs,
    idleTermMin: input.idleTermMin,
    isCoord: Boolean(input.coordHandle && input.handle === input.coordHandle)
  })
  return {
    handle: input.handle,
    title,
    worktreePath: input.worktreePath,
    lastOutputAt: input.lastOutputAt,
    action: idle.action,
    why: idle.why
  }
}

async function pathIsDirectory(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory()
  } catch {
    return false
  }
}

export async function detectOrphanGitdir(worktreePath: string): Promise<boolean> {
  const gitFile = path.join(worktreePath, '.git')
  try {
    const info = await lstat(gitFile)
    if (!info.isFile()) {
      return false
    }
    const marker = parseGitdirMarkerPayload(await readFile(gitFile, 'utf8'))
    if (!marker) {
      return true
    }
    const gitdir = path.isAbsolute(marker) ? marker : path.resolve(worktreePath, marker)
    return !(await pathIsDirectory(gitdir))
  } catch {
    return false
  }
}

function hostRemovalReason(hostId: string | undefined): string | undefined {
  if (!hostId) {
    return 'host-unverifiable'
  }
  if (hostId !== LOCAL_EXECUTION_HOST_ID) {
    return 'host-not-local'
  }
  return undefined
}

export async function evaluateGcWorktree(input: {
  git: GitWorktreeInfo
  repo: string
  orca?: WorktreeGcOrcaMeta
  attachedPaths: ReadonlySet<string>
  processCwds: WorktreeGcProcessCwdScan
  nowMs: number
  runGit: WorktreeGcGitRunner
  listPrStates: WorktreeGcPrLookup
  readAttachedPaths?: () => Promise<ReadonlySet<string>>
  readProcessCwds?: () => Promise<WorktreeGcProcessCwdScan>
}): Promise<WorktreeGcWorktreeRecord> {
  const branch = shortBranchName(input.git.branch)
  const rec: WorktreeGcWorktreeRecord = {
    path: input.git.path,
    branch: branch || '(detached)',
    head: input.git.head,
    repo: input.repo,
    orcaId: input.orca?.id,
    hostId: input.orca?.hostId,
    reasons: [],
    action: 'keep'
  }
  if (input.git.isMainWorktree) {
    rec.reasons.push('main-worktree')
    return rec
  }
  if (input.orca) {
    const hostReason = hostRemovalReason(input.orca.hostId)
    if (hostReason) {
      rec.reasons.push(hostReason)
      rec.action = 'keep'
      return rec
    }
  }
  if (input.git.locked) {
    rec.reasons.push('locked')
  }
  if (input.git.prunable || !(await pathIsDirectory(input.git.path))) {
    rec.reasons = ['missing-dir(prune)']
    rec.action = 'prune'
    return rec
  }
  if (await detectOrphanGitdir(input.git.path)) {
    rec.reasons.push(WORKTREE_GC_ORPHAN_REASON)
    return rec
  }
  const status = await readGitStatusPorcelain(input.git.path, input.runGit)
  if (!status.ok) {
    rec.reasons.push('status-failed')
  } else if (status.dirty) {
    rec.reasons.push('DIRTY')
  }
  if (!branch) {
    rec.reasons.push('detached')
  } else {
    const unpushed = await countUnpushedCommits(input.git.path, input.runGit)
    if (!unpushed.ok || unpushed.count !== '0') {
      rec.reasons.push(`UNPUSHED(${unpushed.count})`)
    }
    const merged = await isMergedIntoDefault(input.git.path, input.runGit)
    if (!merged) {
      const prs = await input.listPrStates(input.git.path, branch)
      const states = new Set(prs.states)
      if (!prs.ok) {
        rec.reasons.push('pr-lookup-failed')
      } else if (states.has('OPEN') || (!states.has('MERGED') && !states.has('CLOSED'))) {
        rec.reasons.push(`not-merged(pr=${[...states].sort().join(',') || 'none'})`)
      }
    }
  }
  if (branch) {
    const liveBranch = await readGitBranch(input.git.path, input.runGit)
    if (!liveBranch) {
      rec.reasons.push('branch-unverifiable')
    } else if (liveBranch !== branch) {
      rec.reasons.push('branch-changed')
    }
  }
  const liveHead = await readGitHead(input.git.path, input.runGit)
  if (!liveHead) {
    rec.reasons.push('head-unverifiable')
  } else if (input.git.head && liveHead !== input.git.head) {
    rec.reasons.push('head-changed')
  }
  const gitMs = await newestGitActivityMs(input.git.path, branch)
  const attachedPaths = input.readAttachedPaths
    ? await input.readAttachedPaths()
    : input.attachedPaths
  const processCwds = input.readProcessCwds ? await input.readProcessCwds() : input.processCwds
  if (attachedPaths.has(input.git.path)) {
    rec.reasons.push('terminal-attached')
  }
  if (processCwds.verdict === 'unverifiable') {
    rec.reasons.push('process-cwd-unverifiable')
  } else if (
    processCwds.cwds.some(
      (cwd) => cwd === input.git.path || isPathInsideOrEqual(input.git.path, cwd)
    )
  ) {
    rec.reasons.push('process-cwd-inside')
  }
  const samples = [input.orca?.lastActivityAt, gitMs].filter(
    (ms): ms is number => typeof ms === 'number' && ms > 0
  )
  const lastMs = samples.length > 0 ? Math.max(...samples) : input.nowMs
  if (input.nowMs - lastMs < WORKTREE_GC_IDLE_MS) {
    rec.reasons.push(`active<24h(${Math.floor((input.nowMs - lastMs) / 3_600_000)}h)`)
  }
  rec.action = rec.reasons.length === 0 ? 'remove' : 'keep'
  return rec
}

export function orphanWorktreeRecord(worktreePath: string): WorktreeGcWorktreeRecord {
  return {
    path: worktreePath,
    branch: '?',
    head: '?',
    repo: '?',
    reasons: [WORKTREE_GC_ORPHAN_REASON],
    action: 'keep'
  }
}
