import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const WORKTREE_GC_COMMAND_SPEC: CommandSpec = {
  path: ['worktree', 'gc'],
  destructive: true,
  summary: 'Garbage-collect idle linked git worktrees and idle terminals',
  usage:
    'orca worktree gc [--apply] [--journal-dir <path>] [--idle-term-min <n>] [--coord-terminal <handle>] [--repo <selector>] [--json]',
  allowedFlags: [
    ...GLOBAL_FLAGS,
    'apply',
    'force',
    'journal-dir',
    'idle-term-min',
    'coord-terminal',
    'repo'
  ],
  notes: [
    'Dry-run is the default. Pass --apply to close idle terminals and remove eligible linked worktrees. --force is refused.',
    'A linked worktree is removed only when all four hold: the branch is merged into the origin default branch or its GitHub PR is MERGED/CLOSED; the tree is clean with no unpushed commits; no Orca terminal is attached and no process cwd is inside it; and it has been idle more than 24h.',
    'Main worktrees and the coordinator terminal are never touched. ORPHAN checkouts (git metadata gone) are listed only.',
    'Before any terminal close or worktree removal the full inventory is written to a journal; a failed write aborts without closing or removing. Apply re-reads terminal idle/incarnation and live worktree evidence immediately before close or rm. After a linked-worktree removal the branch tip is kept at refs/orca-gc/<branch>. --repo matches workspace id and execution host; a truncated or incomplete terminal listing blocks removal. Remote runtimes are refused.',
    'gc never launches terminals, agents, or processes.'
  ],
  examples: ['orca worktree gc --json', 'orca worktree gc --apply --json']
}
