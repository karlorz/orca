import path from 'node:path'
import { runProcess } from '@orca/process-host'
import { GitCapabilityCache } from '../shared/git-capability-cache'
import {
  hasUnsupportedRevParsePathFormatEcho,
  isUnsupportedRevParsePathFormatError
} from '../shared/git-worktree-command-capabilities'
import { parseWorktreeList } from '../shared/git-worktree-porcelain-parser'
import type { GitWorktreeInfo } from '../shared/worktree/types'
import type { WorktreeGcGitResult, WorktreeGcGitRunner } from './worktree-gc-model'

const GIT_ENV: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' }

export async function runGitCommand(
  cwd: string,
  args: readonly string[]
): Promise<WorktreeGcGitResult> {
  try {
    const result = await runProcess({
      program: 'git',
      args,
      cwd,
      env: GIT_ENV,
      timeoutMs: 30_000
    })
    return {
      code: result.timedOut ? 1 : (result.code ?? 1),
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim()
    }
  } catch (error) {
    return {
      code: 1,
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error)
    }
  }
}

function gitFailure(result: WorktreeGcGitResult): Error {
  return Object.assign(new Error(result.stderr || result.stdout || 'git failed'), {
    stderr: result.stderr,
    stdout: result.stdout,
    code: String(result.code)
  })
}

function resolveReportedGitPath(cwd: string, reported: string): string {
  const line = reported
    .split('\n')
    .map((entry) => (entry.endsWith('\r') ? entry.slice(0, -1) : entry))
    .findLast((entry) => entry.length > 0 && !entry.startsWith('-'))
  if (!line) {
    return cwd
  }
  return path.isAbsolute(line) ? line : path.resolve(cwd, line)
}

export async function readGitCommonDir(
  cwd: string,
  runGit: WorktreeGcGitRunner,
  capabilities = new GitCapabilityCache()
): Promise<string | null> {
  const readPreferred = async (): Promise<string> => {
    const result = await runGit(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
    if (result.code !== 0) {
      throw gitFailure(result)
    }
    if (hasUnsupportedRevParsePathFormatEcho(result.stdout)) {
      capabilities.rememberUnsupported('rev-parse-path-format')
    }
    return resolveReportedGitPath(cwd, result.stdout)
  }
  const readFallback = async (): Promise<string> => {
    const result = await runGit(cwd, ['rev-parse', '--git-common-dir'])
    if (result.code !== 0) {
      throw gitFailure(result)
    }
    return resolveReportedGitPath(cwd, result.stdout)
  }
  try {
    return await capabilities.runWithFallback(
      'rev-parse-path-format',
      readPreferred,
      readFallback,
      isUnsupportedRevParsePathFormatError
    )
  } catch {
    return null
  }
}

export function repoRootFromCommonDir(commonDir: string): string {
  return path.basename(commonDir) === '.git' ? path.dirname(commonDir) : commonDir
}

export async function listGitWorktrees(
  repo: string,
  runGit: WorktreeGcGitRunner
): Promise<GitWorktreeInfo[]> {
  const result = await runGit(repo, ['worktree', 'list', '--porcelain'])
  if (result.code !== 0) {
    return []
  }
  return parseWorktreeList(result.stdout)
}

export function shortBranchName(branchRef: string | undefined): string {
  if (!branchRef || branchRef === 'detached') {
    return ''
  }
  return branchRef.replace(/^refs\/heads\//, '')
}

export async function readDefaultBranchRef(
  cwd: string,
  runGit: WorktreeGcGitRunner
): Promise<string> {
  const result = await runGit(cwd, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
  return result.code === 0 && result.stdout.length > 0 ? result.stdout : 'origin/main'
}

export async function countUnpushedCommits(
  cwd: string,
  runGit: WorktreeGcGitRunner
): Promise<{ ok: boolean; count: string }> {
  const upstream = await runGit(cwd, ['rev-list', '--count', '@{u}..HEAD'])
  if (upstream.code === 0) {
    return { ok: true, count: upstream.stdout || '0' }
  }
  const remotes = await runGit(cwd, ['rev-list', '--count', 'HEAD', '--not', '--remotes'])
  if (remotes.code === 0) {
    return { ok: true, count: remotes.stdout || '0' }
  }
  return { ok: false, count: remotes.stdout || upstream.stdout || '?' }
}

export async function isMergedIntoDefault(
  cwd: string,
  runGit: WorktreeGcGitRunner
): Promise<boolean> {
  const defaultBranch = await readDefaultBranchRef(cwd, runGit)
  const result = await runGit(cwd, ['merge-base', '--is-ancestor', 'HEAD', defaultBranch])
  return result.code === 0
}

export async function readGitHead(
  cwd: string,
  runGit: WorktreeGcGitRunner
): Promise<string | null> {
  const result = await runGit(cwd, ['rev-parse', 'HEAD'])
  return result.code === 0 && result.stdout.length > 0 ? result.stdout : null
}

export async function readGitStatusPorcelain(
  cwd: string,
  runGit: WorktreeGcGitRunner
): Promise<{ ok: boolean; dirty: boolean }> {
  // Global --no-optional-locks: Git 2.15+; avoids this process refreshing index mtimes.
  const result = await runGit(cwd, ['--no-optional-locks', 'status', '--porcelain'])
  if (result.code !== 0) {
    return { ok: false, dirty: false }
  }
  return { ok: true, dirty: result.stdout.length > 0 }
}

export async function preserveGcBranchTip(
  repo: string,
  branch: string,
  head: string,
  runGit: WorktreeGcGitRunner
): Promise<void> {
  if (!branch || branch === '(detached)' || !head) {
    return
  }
  await runGit(repo, ['update-ref', `refs/orca-gc/${branch}`, head])
}

export async function removeGitWorktree(
  repo: string,
  worktreePath: string,
  runGit: WorktreeGcGitRunner
): Promise<boolean> {
  const result = await runGit(repo, ['worktree', 'remove', worktreePath])
  return result.code === 0
}

export async function pruneGitWorktrees(repo: string, runGit: WorktreeGcGitRunner): Promise<void> {
  await runGit(repo, ['worktree', 'prune'])
}
