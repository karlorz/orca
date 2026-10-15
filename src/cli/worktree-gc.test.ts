import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { WORKTREE_GC_IDLE_MS } from './worktree-gc-model'
import { runGitCommand } from './worktree-gc-git'
import { runWorktreeGc, worktreeGcJournalStamp } from './worktree-gc-run'
import type { WorktreeGcRuntime } from './worktree-gc-model'

const DAY_MS = WORKTREE_GC_IDLE_MS
const NOW_MS = Date.parse('2026-10-15T08:00:00Z')

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await runGitCommand(cwd, args)
  if (result.code !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`)
  }
  return result.stdout
}

async function createMergedLinkedRepo(): Promise<{
  root: string
  repo: string
  linked: string
  journalDir: string
}> {
  const root = await mkdtemp(path.join(tmpdir(), 'orca-wt-gc-'))
  const repo = path.join(root, 'repo')
  const bare = path.join(root, 'repo.git')
  const linked = path.join(root, 'linked')
  const journalDir = path.join(root, 'journal')
  await mkdir(repo, { recursive: true })
  await git(repo, ['init'])
  await git(repo, ['config', 'user.email', 'gc@test.local'])
  await git(repo, ['config', 'user.name', 'Gc Test'])
  await git(repo, ['config', 'commit.gpgsign', 'false'])
  await git(repo, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
  await writeFile(path.join(repo, 'README.md'), 'main\n')
  await git(repo, ['add', 'README.md'])
  await git(repo, ['commit', '-m', 'init'])
  await git(repo, ['clone', '--bare', repo, bare])
  await git(repo, ['remote', 'add', 'origin', bare])
  await git(repo, ['push', '-u', 'origin', 'HEAD:main'])
  await git(repo, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'])
  await git(repo, ['worktree', 'add', '-b', 'feature/done', linked])
  await git(repo, ['config', 'receive.denyCurrentBranch', 'ignore'])
  return { root, repo, linked, journalDir }
}

function runtimeFor(
  repo: string,
  linked: string,
  options: {
    remove?: (input: { id: string; hostId: string }) => Promise<boolean>
    terminals?: WorktreeGcRuntime['listTerminals']
    closeTerminal?: WorktreeGcRuntime['closeTerminal']
    linkedActivityAt?: number
  } = {}
): WorktreeGcRuntime {
  const worktrees = [
    {
      id: `repo::${repo}`,
      path: repo,
      hostId: 'local',
      lastActivityAt: NOW_MS - DAY_MS * 2,
      isMainWorktree: true
    },
    {
      id: `repo::${linked}`,
      path: linked,
      hostId: 'local',
      lastActivityAt: options.linkedActivityAt ?? NOW_MS - DAY_MS * 2,
      isMainWorktree: false
    }
  ]
  return {
    async listWorktrees() {
      return { worktrees, truncated: false }
    },
    listTerminals: options.terminals ?? (async () => []),
    async readTerminalTail() {
      return ''
    },
    closeTerminal: options.closeTerminal ?? (async () => true),
    removeWorktree:
      options.remove ??
      (async () => {
        throw new Error('worktree.rm should not run in this test')
      })
  }
}

describe('orca worktree gc rules', () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('dry-run is the default and writes a journal without removing', async () => {
    const fixture = await createMergedLinkedRepo()
    roots.push(fixture.root)
    const removed: string[] = []
    const report = await runWorktreeGc({
      apply: false,
      nowMs: NOW_MS,
      idleTermMin: 60,
      coordHandle: 'term_coord',
      journalDir: fixture.journalDir,
      runtime: runtimeFor(fixture.repo, fixture.linked, {
        remove: async (input) => {
          removed.push(input.id)
          return true
        }
      }),
      listPrStates: async () => ({ ok: true, states: ['MERGED'] }),
      listProcessCwds: async () => ({ verdict: 'live', cwds: [] })
    })
    const linked = report.worktrees.find((row) => row.path === fixture.linked)
    expect(linked?.action).toBe('remove')
    expect(removed).toEqual([])
    expect(existsSync(fixture.linked)).toBe(true)
    expect(existsSync(report.journalPath)).toBe(true)
    const journal: unknown = JSON.parse(await readFile(report.journalPath, 'utf8'))
    expect(journal).toEqual(
      expect.objectContaining({
        apply: false,
        worktrees: expect.arrayContaining([
          expect.objectContaining({ path: fixture.linked, branch: 'feature/done' })
        ])
      })
    )
  })

  it('applies only when all four rules hold and keeps refs/orca-gc/<branch>', async () => {
    const fixture = await createMergedLinkedRepo()
    roots.push(fixture.root)
    const head = await git(fixture.linked, ['rev-parse', 'HEAD'])
    const report = await runWorktreeGc({
      apply: true,
      nowMs: NOW_MS,
      idleTermMin: 60,
      coordHandle: 'term_coord',
      journalDir: fixture.journalDir,
      runtime: runtimeFor(fixture.repo, fixture.linked, {
        remove: async () => {
          const result = await runGitCommand(fixture.repo, ['worktree', 'remove', fixture.linked])
          return result.code === 0
        }
      }),
      listPrStates: async () => ({ ok: true, states: ['MERGED'] }),
      listProcessCwds: async () => ({ verdict: 'live', cwds: [] })
    })
    const linked = report.worktrees.find((row) => row.path === fixture.linked)
    expect(linked?.action).toBe('remove')
    expect(linked?.ok).toBe(true)
    expect(existsSync(fixture.linked)).toBe(false)
    expect(await git(fixture.repo, ['rev-parse', 'refs/orca-gc/feature/done'])).toBe(head)
    const journal: unknown = JSON.parse(await readFile(report.journalPath, 'utf8'))
    expect(journal).toEqual(
      expect.objectContaining({
        worktrees: expect.arrayContaining([expect.objectContaining({ path: fixture.linked, head })])
      })
    )
  })

  it('keeps a main worktree even when it would otherwise be idle and clean', async () => {
    const fixture = await createMergedLinkedRepo()
    roots.push(fixture.root)
    const report = await runWorktreeGc({
      apply: false,
      nowMs: NOW_MS,
      idleTermMin: 60,
      coordHandle: null,
      journalDir: fixture.journalDir,
      runtime: runtimeFor(fixture.repo, fixture.linked, {
        remove: async () => {
          throw new Error('main worktree must not be removed')
        }
      }),
      listPrStates: async () => ({ ok: true, states: ['MERGED'] }),
      listProcessCwds: async () => ({ verdict: 'live', cwds: [] })
    })
    const main = report.worktrees.find((row) => row.path === fixture.repo)
    expect(main?.action).toBe('keep')
    expect(main?.reasons).toContain('main-worktree')
    expect(existsSync(fixture.repo)).toBe(true)
  })

  it('does not remove when any of the four rules fail', async () => {
    const fixture = await createMergedLinkedRepo()
    roots.push(fixture.root)
    await writeFile(path.join(fixture.linked, 'dirty.txt'), 'nope\n')
    const report = await runWorktreeGc({
      apply: true,
      nowMs: NOW_MS,
      idleTermMin: 60,
      coordHandle: null,
      journalDir: fixture.journalDir,
      runtime: runtimeFor(fixture.repo, fixture.linked, {
        remove: async () => {
          throw new Error('dirty worktree must not be removed')
        }
      }),
      listPrStates: async () => ({ ok: true, states: ['MERGED'] }),
      listProcessCwds: async () => ({ verdict: 'live', cwds: [] })
    })
    expect(report.worktrees.find((row) => row.path === fixture.linked)?.action).toBe('keep')
    expect(report.worktrees.find((row) => row.path === fixture.linked)?.reasons).toContain('DIRTY')
    expect(existsSync(fixture.linked)).toBe(true)
  })

  it('lists ORPHAN dirs without deleting them', async () => {
    const fixture = await createMergedLinkedRepo()
    roots.push(fixture.root)
    const orphan = path.join(fixture.root, 'orphan')
    await mkdir(orphan, { recursive: true })
    await writeFile(path.join(orphan, '.git'), 'gitdir: /missing/orca-gc-gitdir\n')
    const report = await runWorktreeGc({
      apply: true,
      nowMs: NOW_MS,
      idleTermMin: 60,
      coordHandle: null,
      journalDir: fixture.journalDir,
      runtime: {
        async listWorktrees() {
          return {
            worktrees: [
              {
                id: `repo::${fixture.repo}`,
                path: fixture.repo,
                hostId: 'local',
                lastActivityAt: NOW_MS - DAY_MS * 2,
                isMainWorktree: true
              },
              {
                id: `repo::${orphan}`,
                path: orphan,
                hostId: 'local',
                lastActivityAt: NOW_MS - DAY_MS * 2,
                isMainWorktree: false
              }
            ],
            truncated: false
          }
        },
        async listTerminals() {
          return []
        },
        async readTerminalTail() {
          return ''
        },
        async closeTerminal() {
          return true
        },
        async removeWorktree() {
          throw new Error('orphans must not be removed')
        }
      },
      listPrStates: async () => ({ ok: true, states: ['MERGED'] }),
      listProcessCwds: async () => ({ verdict: 'live', cwds: [] })
    })
    const row = report.worktrees.find((entry) => entry.path === orphan)
    expect(row?.action).toBe('keep')
    expect(row?.reasons.some((reason) => reason.includes('ORPHAN'))).toBe(true)
    expect(existsSync(orphan)).toBe(true)
  })

  it('writes the inventory journal before a linked-worktree removal', async () => {
    const fixture = await createMergedLinkedRepo()
    roots.push(fixture.root)
    const journalPath = path.join(fixture.journalDir, `gc-${worktreeGcJournalStamp(NOW_MS)}.json`)
    let journalAtRemove = false
    const report = await runWorktreeGc({
      apply: true,
      nowMs: NOW_MS,
      idleTermMin: 60,
      coordHandle: null,
      journalDir: fixture.journalDir,
      runtime: runtimeFor(fixture.repo, fixture.linked, {
        remove: async () => {
          journalAtRemove = existsSync(journalPath)
          const result = await runGitCommand(fixture.repo, ['worktree', 'remove', fixture.linked])
          return result.code === 0
        }
      }),
      listPrStates: async () => ({ ok: true, states: ['MERGED'] }),
      listProcessCwds: async () => ({ verdict: 'live', cwds: [] })
    })
    expect(report.journalPath).toBe(journalPath)
    expect(journalAtRemove).toBe(true)
  })

  it('never closes the coord terminal even when it is idle', async () => {
    const fixture = await createMergedLinkedRepo()
    roots.push(fixture.root)
    const closed: string[] = []
    const report = await runWorktreeGc({
      apply: true,
      nowMs: NOW_MS,
      idleTermMin: 60,
      coordHandle: 'term_coord',
      journalDir: fixture.journalDir,
      runtime: runtimeFor(fixture.repo, fixture.linked, {
        remove: async () => true,
        terminals: async () => [
          {
            handle: 'term_coord',
            title: 'coord',
            worktreePath: fixture.repo,
            lastOutputAt: NOW_MS - 3 * 60 * 60 * 1000
          }
        ],
        closeTerminal: async (handle) => {
          closed.push(handle)
          return true
        }
      }),
      listPrStates: async () => ({ ok: true, states: ['MERGED'] }),
      listProcessCwds: async () => ({ verdict: 'live', cwds: [] })
    })
    expect(report.terminals[0]?.action).toBe('keep')
    expect(report.terminals[0]?.why).toBe('coord')
    expect(closed).toEqual([])
  })

  it.each([
    {
      name: 'unpushed commits',
      setup: async (linked: string) => {
        await git(linked, ['commit', '--allow-empty', '-m', 'local-only'])
      },
      reason: 'UNPUSHED'
    },
    {
      name: 'a still-open PR that is not merged into origin default',
      setup: async (linked: string) => {
        await git(linked, ['commit', '--allow-empty', '-m', 'pr-head'])
        await git(linked, ['push', '-u', 'origin', 'HEAD'])
      },
      reason: 'not-merged',
      prStates: ['OPEN']
    },
    {
      name: 'activity inside 24h',
      setup: async () => undefined,
      reason: 'active<24h',
      linkedActivityAt: NOW_MS - 60_000
    }
  ])('keeps a linked worktree for $name', async ({ setup, reason, prStates, linkedActivityAt }) => {
    const fixture = await createMergedLinkedRepo()
    roots.push(fixture.root)
    await setup(fixture.linked)
    const report = await runWorktreeGc({
      apply: true,
      nowMs: NOW_MS,
      idleTermMin: 60,
      coordHandle: null,
      journalDir: fixture.journalDir,
      runtime: runtimeFor(fixture.repo, fixture.linked, {
        linkedActivityAt,
        remove: async () => {
          throw new Error(`${reason} worktree must not be removed`)
        }
      }),
      listPrStates: async () => ({ ok: true, states: prStates ?? ['MERGED'] }),
      listProcessCwds: async () => ({ verdict: 'live', cwds: [] })
    })
    const linked = report.worktrees.find((row) => row.path === fixture.linked)
    expect(linked?.action).toBe('keep')
    expect(linked?.reasons.some((entry) => entry.includes(reason))).toBe(true)
    expect(existsSync(fixture.linked)).toBe(true)
  })

  it('keeps a linked worktree with an attached terminal or process cwd', async () => {
    const fixture = await createMergedLinkedRepo()
    roots.push(fixture.root)
    const attached = await runWorktreeGc({
      apply: true,
      nowMs: NOW_MS,
      idleTermMin: 60,
      coordHandle: null,
      journalDir: fixture.journalDir,
      runtime: runtimeFor(fixture.repo, fixture.linked, {
        terminals: async () => [
          {
            handle: 'term_worker',
            title: 'worker',
            worktreePath: fixture.linked,
            lastOutputAt: NOW_MS
          }
        ],
        remove: async () => {
          throw new Error('attached worktree must not be removed')
        }
      }),
      listPrStates: async () => ({ ok: true, states: ['MERGED'] }),
      listProcessCwds: async () => ({ verdict: 'live', cwds: [] })
    })
    expect(attached.worktrees.find((row) => row.path === fixture.linked)?.reasons).toContain(
      'terminal-attached'
    )
    const cwdInside = await runWorktreeGc({
      apply: true,
      nowMs: NOW_MS,
      idleTermMin: 60,
      coordHandle: null,
      journalDir: fixture.journalDir,
      runtime: runtimeFor(fixture.repo, fixture.linked, {
        remove: async () => {
          throw new Error('process-cwd worktree must not be removed')
        }
      }),
      listPrStates: async () => ({ ok: true, states: ['MERGED'] }),
      listProcessCwds: async () => ({ verdict: 'live', cwds: [fixture.linked] })
    })
    expect(cwdInside.worktrees.find((row) => row.path === fixture.linked)?.reasons).toContain(
      'process-cwd-inside'
    )
  })

  it('removes an unmerged branch whose GitHub PR is MERGED or CLOSED', async () => {
    const fixture = await createMergedLinkedRepo()
    roots.push(fixture.root)
    await git(fixture.linked, ['commit', '--allow-empty', '-m', 'closed-pr'])
    await git(fixture.linked, ['push', '-u', 'origin', 'HEAD'])
    const head = await git(fixture.linked, ['rev-parse', 'HEAD'])
    const report = await runWorktreeGc({
      apply: true,
      nowMs: NOW_MS,
      idleTermMin: 60,
      coordHandle: null,
      journalDir: fixture.journalDir,
      runtime: runtimeFor(fixture.repo, fixture.linked, {
        remove: async () => {
          const result = await runGitCommand(fixture.repo, ['worktree', 'remove', fixture.linked])
          return result.code === 0
        }
      }),
      listPrStates: async () => ({ ok: true, states: ['CLOSED'] }),
      listProcessCwds: async () => ({ verdict: 'live', cwds: [] })
    })
    expect(report.worktrees.find((row) => row.path === fixture.linked)?.action).toBe('remove')
    expect(existsSync(fixture.linked)).toBe(false)
    expect(await git(fixture.repo, ['rev-parse', 'refs/orca-gc/feature/done'])).toBe(head)
  })
})
