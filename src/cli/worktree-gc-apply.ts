import { classifyGcTerminal, liveEvidenceBlocksGcRemoval } from './worktree-gc-eligibility'
import { preserveGcBranchTip, pruneGitWorktrees, removeGitWorktree } from './worktree-gc-git'
import type {
  WorktreeGcGitRunner,
  WorktreeGcProcessCwdScan,
  WorktreeGcReport,
  WorktreeGcRuntime,
  WorktreeGcTerminalRecord
} from './worktree-gc-model'
import {
  attachedPathsFromTerminals,
  terminalInventoryIsComplete
} from './worktree-gc-terminal-scope'

async function revalidateTerminalClose(
  terminal: WorktreeGcTerminalRecord,
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

export async function applyWorktreeGcDestructions(input: {
  report: WorktreeGcReport
  runtime: WorktreeGcRuntime
  nowMs: number
  idleTermMin: number
  coordHandle: string | null
  listProcessCwds: () => Promise<WorktreeGcProcessCwdScan>
  runGit: WorktreeGcGitRunner
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
    terminal.ok = await input.runtime.closeTerminal(terminal.handle, decision.incarnationId)
  }
  const listed = await input.runtime.listWorktrees()
  const terminals = await input.runtime.listTerminals()
  const processCwds = await input.listProcessCwds()
  const attached = attachedPathsFromTerminals(terminals.terminals)
  const byId = new Map(listed.worktrees.map((worktree) => [worktree.id, worktree]))
  const listingComplete = !listed.truncated && terminalInventoryIsComplete(terminals)
  const repos = new Set<string>()
  for (const rec of input.report.worktrees) {
    if (rec.action !== 'remove') {
      if (rec.repo && rec.repo !== '?') {
        repos.add(rec.repo)
      }
      continue
    }
    if (!listingComplete) {
      rec.action = 'keep'
      rec.reasons.push('terminal-list-incomplete')
      continue
    }
    const orca = rec.orcaId ? byId.get(rec.orcaId) : undefined
    const blocked = liveEvidenceBlocksGcRemoval({
      path: rec.path,
      attachedPaths: attached,
      processCwds,
      lastActivityAt: orca?.lastActivityAt,
      nowMs: input.nowMs
    })
    if (blocked) {
      rec.action = 'keep'
      rec.reasons.push(blocked)
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
