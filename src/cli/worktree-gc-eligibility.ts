import { lstat, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { isPathInsideOrEqual } from '../shared/cross-platform-path'
import { LOCAL_EXECUTION_HOST_ID } from '../shared/execution-host'
import { parseGitdirMarkerPayload } from '../shared/gitdir-marker-payload'
import type { GitWorktreeInfo } from '../shared/worktree/types'
import {
  countUnpushedCommits,
  isMergedIntoDefault,
  readGitStatusPorcelain,
  shortBranchName
} from './worktree-gc-git'
import {
  WORKTREE_GC_BUSY_MARKS,
  WORKTREE_GC_IDLE_MS,
  WORKTREE_GC_ORPHAN_REASON,
  type WorktreeGcGitRunner,
  type WorktreeGcOrcaMeta,
  type WorktreeGcPrLookup,
  type WorktreeGcProcessCwdScan,
  type WorktreeGcTerminalRecord,
  type WorktreeGcWorktreeRecord
} from './worktree-gc-model'

export function isWorktreeGcBusyTail(tail: string): boolean {
  return WORKTREE_GC_BUSY_MARKS.some((mark) => tail.includes(mark))
}

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
  const base = {
    handle: input.handle,
    title,
    worktreePath: input.worktreePath
  }
  if (input.coordHandle && input.handle === input.coordHandle) {
    return { ...base, lastOutputAt: input.lastOutputAt, action: 'keep', why: 'coord' }
  }
  if (isWorktreeGcBusyTail(input.tail)) {
    return { ...base, lastOutputAt: input.lastOutputAt, action: 'keep', why: 'busy' }
  }
  const lastOutputAt = input.lastOutputAt ?? input.nowMs
  const idleMs = input.nowMs - lastOutputAt
  if (idleMs < input.idleTermMin * 60 * 1000) {
    return {
      ...base,
      lastOutputAt: input.lastOutputAt,
      action: 'keep',
      why: `recent-output(${Math.floor(idleMs / 60_000)}m)`
    }
  }
  return { ...base, lastOutputAt: input.lastOutputAt, action: 'close', why: 'idle' }
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

async function newestGitMtimeMs(worktreePath: string): Promise<number | null> {
  const candidates = [
    path.join(worktreePath, '.git'),
    path.join(worktreePath, '.git', 'HEAD'),
    path.join(worktreePath, '.git', 'index'),
    worktreePath
  ]
  let newest: number | null = null
  for (const candidate of candidates) {
    try {
      const mtimeMs = (await stat(candidate)).mtimeMs
      newest = newest === null ? mtimeMs : Math.max(newest, mtimeMs)
    } catch {
      // Missing HEAD/index is normal for a gitfile worktree.
    }
  }
  const gitFile = path.join(worktreePath, '.git')
  try {
    const info = await lstat(gitFile)
    if (info.isFile()) {
      const marker = parseGitdirMarkerPayload(await readFile(gitFile, 'utf8'))
      if (marker) {
        const gitdir = path.isAbsolute(marker) ? marker : path.resolve(worktreePath, marker)
        for (const name of ['HEAD', 'index']) {
          try {
            const mtimeMs = (await stat(path.join(gitdir, name))).mtimeMs
            newest = newest === null ? mtimeMs : Math.max(newest, mtimeMs)
          } catch {
            // Linked worktrees may omit index until first use.
          }
        }
      }
    }
  } catch {
    // No git metadata.
  }
  return newest
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
  if (input.attachedPaths.has(input.git.path)) {
    rec.reasons.push('terminal-attached')
  }
  if (input.processCwds.verdict === 'unverifiable') {
    rec.reasons.push('process-cwd-unverifiable')
  } else if (
    input.processCwds.cwds.some(
      (cwd) => cwd === input.git.path || isPathInsideOrEqual(input.git.path, cwd)
    )
  ) {
    rec.reasons.push('process-cwd-inside')
  }
  const activityAt = input.orca?.lastActivityAt
  const lastMs =
    activityAt && activityAt > 0
      ? activityAt
      : ((await newestGitMtimeMs(input.git.path)) ?? input.nowMs)
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
