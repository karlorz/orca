import { chmod, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { GitWorktreeInfo } from '../shared/worktree/types'
import { LOCAL_EXECUTION_HOST_ID } from '../shared/execution-host'
import {
  classifyGcTerminal,
  detectOrphanGitdir,
  evaluateGcWorktree,
  orphanWorktreeRecord
} from './worktree-gc-eligibility'
import {
  listGitWorktrees,
  preserveGcBranchTip,
  pruneGitWorktrees,
  readGitCommonDir,
  removeGitWorktree,
  repoRootFromCommonDir,
  runGitCommand
} from './worktree-gc-git'
import type {
  WorktreeGcGitRunner,
  WorktreeGcPrLookup,
  WorktreeGcProcessCwdScan,
  WorktreeGcReport,
  WorktreeGcRuntime,
  WorktreeGcRuntimeWorktree
} from './worktree-gc-model'

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

export function worktreeGcJournalStamp(nowMs: number): string {
  const date = new Date(nowMs)
  return `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}-${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}${pad2(date.getUTCSeconds())}`
}

export async function writeWorktreeGcJournal(
  journalPath: string,
  report: WorktreeGcReport
): Promise<void> {
  await mkdir(path.dirname(journalPath), { recursive: true, mode: 0o700 })
  await writeFile(journalPath, `${JSON.stringify(report, null, 1)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  })
  await chmod(journalPath, 0o600)
}

function orcaByPath(
  worktrees: WorktreeGcRuntimeWorktree[]
): Map<string, WorktreeGcRuntimeWorktree> {
  return new Map(worktrees.map((worktree) => [worktree.path, worktree]))
}

async function collectRepoRoots(
  worktrees: WorktreeGcRuntimeWorktree[],
  runGit: WorktreeGcGitRunner
): Promise<string[]> {
  const roots = new Set<string>()
  for (const worktree of worktrees) {
    if (worktree.hostId && worktree.hostId !== LOCAL_EXECUTION_HOST_ID) {
      continue
    }
    const commonDir = await readGitCommonDir(worktree.path, runGit)
    if (commonDir) {
      roots.add(repoRootFromCommonDir(commonDir))
    }
  }
  return [...roots].sort()
}

function attachedPathsFromTerminals(terminals: { worktreePath: string }[]): Set<string> {
  return new Set(
    terminals.map((terminal) => terminal.worktreePath).filter((entry) => entry.length > 0)
  )
}

export type RunWorktreeGcInput = {
  apply: boolean
  nowMs: number
  idleTermMin: number
  coordHandle: string | null
  journalDir: string
  runtime: WorktreeGcRuntime
  runGit?: WorktreeGcGitRunner
  listPrStates?: WorktreeGcPrLookup
  listProcessCwds: () => Promise<WorktreeGcProcessCwdScan>
}

export async function runWorktreeGc(input: RunWorktreeGcInput): Promise<WorktreeGcReport> {
  const runGit = input.runGit ?? runGitCommand
  const listPrStates = input.listPrStates ?? (async () => ({ ok: false, states: [] as const }))
  const listed = await input.runtime.listWorktrees()
  const terminals = await input.runtime.listTerminals()
  const report: WorktreeGcReport = {
    ts: new Date(input.nowMs).toISOString(),
    apply: input.apply,
    coord: input.coordHandle,
    journalPath: path.join(input.journalDir, `gc-${worktreeGcJournalStamp(input.nowMs)}.json`),
    terminals: [],
    worktrees: []
  }
  if (listed.truncated && input.apply) {
    report.worktrees.push({
      path: '?',
      branch: '?',
      head: '?',
      repo: '?',
      reasons: ['listing-truncated'],
      action: 'keep'
    })
    await writeWorktreeGcJournal(report.journalPath, report)
    return report
  }
  for (const terminal of terminals) {
    const tail = await input.runtime.readTerminalTail(terminal.handle)
    report.terminals.push(
      classifyGcTerminal({
        handle: terminal.handle,
        title: terminal.title,
        worktreePath: terminal.worktreePath,
        lastOutputAt: terminal.lastOutputAt,
        tail,
        nowMs: input.nowMs,
        idleTermMin: input.idleTermMin,
        coordHandle: input.coordHandle
      })
    )
  }
  const attached = attachedPathsFromTerminals(terminals)
  const processCwds = await input.listProcessCwds()
  const byPath = orcaByPath(listed.worktrees)
  const seen = new Set<string>()
  for (const repo of await collectRepoRoots(listed.worktrees, runGit)) {
    const gitWorktrees = await listGitWorktrees(repo, runGit)
    for (const git of gitWorktrees) {
      seen.add(git.path)
      report.worktrees.push(
        await evaluateGcWorktree({
          git,
          repo,
          orca: byPath.get(git.path),
          attachedPaths: attached,
          processCwds,
          nowMs: input.nowMs,
          runGit,
          listPrStates
        })
      )
    }
  }
  for (const worktree of listed.worktrees) {
    if (seen.has(worktree.path)) {
      continue
    }
    if (await detectOrphanGitdir(worktree.path)) {
      report.worktrees.push({ ...orphanWorktreeRecord(worktree.path), orcaId: worktree.id })
      continue
    }
    const git: GitWorktreeInfo = {
      path: worktree.path,
      head: '',
      branch: '',
      isBare: false,
      isMainWorktree: worktree.isMainWorktree === true
    }
    report.worktrees.push(
      await evaluateGcWorktree({
        git,
        repo: '?',
        orca: worktree,
        attachedPaths: attached,
        processCwds,
        nowMs: input.nowMs,
        runGit,
        listPrStates
      })
    )
  }
  await writeWorktreeGcJournal(report.journalPath, report)
  if (!input.apply) {
    return report
  }
  for (const terminal of report.terminals) {
    if (terminal.action !== 'close') {
      continue
    }
    terminal.ok = await input.runtime.closeTerminal(terminal.handle)
  }
  const repos = new Set<string>()
  for (const rec of report.worktrees) {
    if (rec.action !== 'remove') {
      continue
    }
    rec.ok =
      rec.orcaId && rec.hostId
        ? await input.runtime.removeWorktree({ id: rec.orcaId, hostId: rec.hostId })
        : await removeGitWorktree(rec.repo, rec.path, runGit)
    await preserveGcBranchTip(rec.repo, rec.branch, rec.head, runGit)
    if (rec.repo && rec.repo !== '?') {
      repos.add(rec.repo)
    }
  }
  for (const rec of report.worktrees) {
    if (rec.repo && rec.repo !== '?') {
      repos.add(rec.repo)
    }
  }
  for (const repo of repos) {
    await pruneGitWorktrees(repo, runGit)
  }
  await writeWorktreeGcJournal(report.journalPath, report)
  return report
}

export function formatWorktreeGcReport(report: WorktreeGcReport): string {
  const lines = [`orca-gc ${report.apply ? 'APPLY' : 'DRY-RUN'} journal=${report.journalPath}`]
  for (const terminal of report.terminals) {
    lines.push(
      `term ${terminal.action.padEnd(6)} ${terminal.handle.slice(0, 13)} ${terminal.why} ${terminal.title}`
    )
  }
  for (const worktree of report.worktrees) {
    if (worktree.reasons.length === 1 && worktree.reasons[0] === 'main-worktree') {
      continue
    }
    const head = worktree.head.slice(0, 8)
    const reasons = worktree.reasons.join(',') || 'eligible'
    const ok = worktree.ok === undefined ? '' : ` ok=${String(worktree.ok)}`
    lines.push(
      `wt   ${worktree.action.padEnd(6)} ${worktree.path} [${worktree.branch} ${head}] ${reasons}${ok}`
    )
  }
  return lines.join('\n')
}

export function eligibleRemoveCount(report: WorktreeGcReport): number {
  return report.worktrees.filter((worktree) => worktree.action === 'remove').length
}
