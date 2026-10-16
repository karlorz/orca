import { evaluateGcWorktree, classifyGcTerminal } from './worktree-gc-eligibility'
import {
  listGitWorktrees,
  preserveGcBranchTip,
  pruneGitWorktrees,
  removeGitWorktree
} from './worktree-gc-git'
import type {
  WorktreeGcGitRunner,
  WorktreeGcPrLookup,
  WorktreeGcProcessCwdScan,
  WorktreeGcReport,
  WorktreeGcRuntime,
  WorktreeGcWorktreeRecord
} from './worktree-gc-model'
import {
  attachedPathsFromTerminals,
  terminalInventoryIsComplete
} from './worktree-gc-terminal-scope'

async function revalidateTerminalClose(
  terminal: { handle: string; incarnationId?: string | null },
  input: {
    runtime: WorktreeGcRuntime
    nowMs: number
    idleTermMin: number
    coordHandle: string | null
  }
): Promise<{ close: true; incarnationId: string } | { close: false; why: string }> {
  const listed = await input.runtime.listTerminals()
  const row = listed.terminals.find((entry) => entry.handle === terminal.handle)
  if (!row) {
    return { close: false, why: 'revalidate-missing' }
  }
  const incarnationId = row.incarnationId
  if (!incarnationId) {
    return { close: false, why: 'incarnation-unverifiable' }
  }
  if (terminal.incarnationId && terminal.incarnationId !== incarnationId) {
    return { close: false, why: 'incarnation-changed' }
  }
  let tail: string
  try {
    tail = await input.runtime.readTerminalTail(terminal.handle)
  } catch {
    return { close: false, why: 'revalidate-unverifiable' }
  }
  const again = classifyGcTerminal({
    handle: row.handle,
    title: row.title,
    worktreePath: row.worktreePath,
    lastOutputAt: row.lastOutputAt,
    tail,
    nowMs: input.nowMs,
    idleTermMin: input.idleTermMin,
    coordHandle: input.coordHandle
  })
  if (again.action !== 'close') {
    return { close: false, why: again.why }
  }
  return { close: true, incarnationId }
}

function keepWorktree(rec: WorktreeGcWorktreeRecord, reason: string): WorktreeGcWorktreeRecord {
  rec.action = 'keep'
  rec.reasons.push(reason)
  return rec
}

async function revalidateWorktreeRemoval(
  rec: WorktreeGcWorktreeRecord,
  input: {
    runtime: WorktreeGcRuntime
    nowMs: number
    listProcessCwds: () => Promise<WorktreeGcProcessCwdScan>
    runGit: WorktreeGcGitRunner
    listPrStates: WorktreeGcPrLookup
  }
): Promise<WorktreeGcWorktreeRecord> {
  const listed = await input.runtime.listWorktrees()
  const terminals = await input.runtime.listTerminals()
  const processCwds = await input.listProcessCwds()
  if (listed.truncated || !terminalInventoryIsComplete(terminals)) {
    return keepWorktree(rec, 'terminal-list-incomplete')
  }
  if (!rec.repo || rec.repo === '?') {
    return keepWorktree(rec, 'workspace-identity-changed')
  }
  const orca = rec.orcaId
    ? listed.worktrees.find((worktree) => worktree.id === rec.orcaId)
    : listed.worktrees.find((worktree) => worktree.path === rec.path)
  if (rec.orcaId) {
    if (!orca || orca.path !== rec.path || (rec.hostId && orca.hostId !== rec.hostId)) {
      return keepWorktree(rec, 'workspace-identity-changed')
    }
  }
  const git = (await listGitWorktrees(rec.repo, input.runGit)).find(
    (worktree) => worktree.path === rec.path
  )
  if (!git) {
    return keepWorktree(rec, 'workspace-identity-changed')
  }
  const fresh = await evaluateGcWorktree({
    git,
    repo: rec.repo,
    orca: orca
      ? { id: orca.id, hostId: orca.hostId, lastActivityAt: orca.lastActivityAt }
      : undefined,
    attachedPaths: attachedPathsFromTerminals(terminals.terminals),
    processCwds,
    nowMs: input.nowMs,
    runGit: input.runGit,
    listPrStates: input.listPrStates
  })
  rec.branch = fresh.branch
  rec.head = fresh.head
  rec.orcaId = fresh.orcaId
  rec.hostId = fresh.hostId
  rec.reasons = fresh.reasons
  rec.action = fresh.action
  return rec
}

export async function applyWorktreeGcDestructions(input: {
  report: WorktreeGcReport
  runtime: WorktreeGcRuntime
  nowMs: number
  idleTermMin: number
  coordHandle: string | null
  listProcessCwds: () => Promise<WorktreeGcProcessCwdScan>
  runGit: WorktreeGcGitRunner
  listPrStates: WorktreeGcPrLookup
}): Promise<void> {
  for (const terminal of input.report.terminals) {
    if (terminal.action !== 'close') {
      continue
    }
    const decision = await revalidateTerminalClose(terminal, input)
    if (!decision.close) {
      terminal.action = 'keep'
      terminal.why = decision.why
      continue
    }
    try {
      terminal.ok = await input.runtime.closeTerminal(
        terminal.handle,
        decision.incarnationId,
        input.idleTermMin,
        input.coordHandle
      )
    } catch {
      terminal.ok = false
    }
    if (!terminal.ok) {
      terminal.action = 'keep'
      terminal.why = 'gc-close-refused'
    }
  }
  const repos = new Set<string>()
  for (const rec of input.report.worktrees) {
    if (rec.action !== 'remove') {
      if (rec.repo && rec.repo !== '?') {
        repos.add(rec.repo)
      }
      continue
    }
    await revalidateWorktreeRemoval(rec, input)
    if (rec.action !== 'remove') {
      continue
    }
    rec.ok =
      rec.orcaId && rec.hostId
        ? await input.runtime.removeWorktree({ id: rec.orcaId, hostId: rec.hostId })
        : await removeGitWorktree(rec.repo, rec.path, input.runGit)
    await preserveGcBranchTip(rec.repo, rec.branch, rec.head, input.runGit)
    if (rec.repo && rec.repo !== '?') {
      repos.add(rec.repo)
    }
  }
  for (const rec of input.report.worktrees) {
    if (rec.repo && rec.repo !== '?') {
      repos.add(rec.repo)
    }
  }
  for (const repo of repos) {
    await pruneGitWorktrees(repo, input.runGit)
  }
}
