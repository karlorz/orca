import { lstat, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { parseGitdirMarkerPayload } from '../shared/gitdir-marker-payload'
import { WORKTREE_GC_IDLE_MS } from './worktree-gc-model'
import { runGitCommand } from './worktree-gc-git'
import { runWorktreeGc, worktreeGcJournalStamp } from './worktree-gc-run'
import type {
  WorktreeGcRuntime,
  WorktreeGcRuntimeTerminal,
  WorktreeGcTerminalList
} from './worktree-gc-model'
import { completeGcTerminalList } from './worktree-gc-terminal-scope'
import { gitActivityStampTargets } from './worktree-gc-git-activity'

const DAY_MS = WORKTREE_GC_IDLE_MS
const NOW_MS = Date.parse('2026-10-15T08:00:00Z')

async function stampMtime(target: string, mtimeMs: number): Promise<void> {
  try {
    await utimes(target, mtimeMs / 1000, mtimeMs / 1000)
  } catch {
    // Missing HEAD/index is normal for a gitfile worktree.
  }
}

async function ageGitActivity(worktreePath: string, mtimeMs: number, branch = ''): Promise<void> {
  for (const target of await gitActivityStampTargets(worktreePath, branch)) {
    await stampMtime(target, mtimeMs)
  }
}

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
  const idleMs = NOW_MS - DAY_MS * 2
  await ageGitActivity(repo, idleMs, 'main')
  await ageGitActivity(linked, idleMs, 'feature/done')
  return { root, repo, linked, journalDir }
}

function runtimeFor(
  repo: string,
  linked: string,
  options: {
    remove?: (input: { id: string; hostId: string }) => Promise<boolean>
    terminals?: () => Promise<WorktreeGcRuntimeTerminal[] | WorktreeGcTerminalList>
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
    async listTerminals() {
      const listed = options.terminals ? await options.terminals() : []
      return Array.isArray(listed) ? completeGcTerminalList(listed) : listed
    },
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
          return completeGcTerminalList()
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

  it('journals the complete inventory before closing any terminal', async () => {
    const fixture = await createMergedLinkedRepo()
    roots.push(fixture.root)
    const journalPath = path.join(fixture.journalDir, `gc-${worktreeGcJournalStamp(NOW_MS)}.json`)
    let journalAtClose: unknown
    const closed: string[] = []
    const report = await runWorktreeGc({
      apply: true,
      nowMs: NOW_MS,
      idleTermMin: 60,
      coordHandle: null,
      journalDir: fixture.journalDir,
      runtime: runtimeFor(fixture.repo, fixture.linked, {
        terminals: async () => [
          {
            handle: 'term_idle',
            title: 'idle',
            worktreePath: fixture.repo,
            worktreeId: `repo::${fixture.repo}`,
            lastOutputAt: NOW_MS - 3 * 60 * 60 * 1000,
            incarnationId: 'inc-idle',
            executionHostId: 'local'
          }
        ],
        closeTerminal: async (handle) => {
          journalAtClose = JSON.parse(await readFile(journalPath, 'utf8'))
          closed.push(handle)
          return true
        },
        remove: async () => true
      }),
      listPrStates: async () => ({ ok: true, states: ['MERGED'] }),
      listProcessCwds: async () => ({ verdict: 'live', cwds: [] })
    })
    expect(closed).toEqual(['term_idle'])
    expect(journalAtClose).toEqual(
      expect.objectContaining({
        terminals: expect.arrayContaining([
          expect.objectContaining({ handle: 'term_idle', action: 'close' })
        ]),
        worktrees: expect.arrayContaining([
          expect.objectContaining({ path: fixture.linked, action: 'remove' })
        ])
      })
    )
    expect(report.terminals[0]?.ok).toBe(true)
  })

  it('aborts closes and removals when the inventory journal cannot be written', async () => {
    const fixture = await createMergedLinkedRepo()
    roots.push(fixture.root)
    const blocked = path.join(fixture.root, 'journal-is-a-file')
    await writeFile(blocked, 'not-a-directory\n')
    const closed: string[] = []
    const removed: string[] = []
    await expect(
      runWorktreeGc({
        apply: true,
        nowMs: NOW_MS,
        idleTermMin: 60,
        coordHandle: null,
        journalDir: blocked,
        runtime: runtimeFor(fixture.repo, fixture.linked, {
          terminals: async () => [
            {
              handle: 'term_idle',
              title: 'idle',
              worktreePath: fixture.repo,
              worktreeId: `repo::${fixture.repo}`,
              lastOutputAt: NOW_MS - 3 * 60 * 60 * 1000,
              incarnationId: 'inc-idle',
              executionHostId: 'local'
            }
          ],
          closeTerminal: async (handle) => {
            closed.push(handle)
            return true
          },
          remove: async (input) => {
            removed.push(input.id)
            return true
          }
        }),
        listPrStates: async () => ({ ok: true, states: ['MERGED'] }),
        listProcessCwds: async () => ({ verdict: 'live', cwds: [] })
      })
    ).rejects.toThrow()
    expect(closed).toEqual([])
    expect(removed).toEqual([])
    expect(existsSync(fixture.linked)).toBe(true)
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
    const unverifiable = await runWorktreeGc({
      apply: true,
      nowMs: NOW_MS,
      idleTermMin: 60,
      coordHandle: null,
      journalDir: fixture.journalDir,
      runtime: runtimeFor(fixture.repo, fixture.linked, {
        remove: async () => {
          throw new Error('unverifiable process cwd must not be removed')
        }
      }),
      listPrStates: async () => ({ ok: true, states: ['MERGED'] }),
      listProcessCwds: async () => ({ verdict: 'unverifiable' })
    })
    expect(unverifiable.worktrees.find((row) => row.path === fixture.linked)?.reasons).toContain(
      'process-cwd-unverifiable'
    )
  })

  it('keeps a recently committed same-branch worktree without touching checkout root or HEAD', async () => {
    const fixture = await createMergedLinkedRepo()
    roots.push(fixture.root)
    await git(fixture.linked, ['commit', '--allow-empty', '-m', 'recent-same-branch'])
    await git(fixture.linked, ['push', '-u', 'origin', 'HEAD'])
    const idleMs = NOW_MS - DAY_MS * 2
    await stampMtime(fixture.linked, idleMs)
    await stampMtime(path.join(fixture.linked, '.git'), idleMs)
    try {
      const info = await lstat(path.join(fixture.linked, '.git'))
      if (info.isFile()) {
        const marker = parseGitdirMarkerPayload(
          await readFile(path.join(fixture.linked, '.git'), 'utf8')
        )
        if (marker) {
          const gitdir = path.isAbsolute(marker) ? marker : path.resolve(fixture.linked, marker)
          await stampMtime(path.join(gitdir, 'HEAD'), idleMs)
        }
      } else {
        await stampMtime(path.join(fixture.linked, '.git', 'HEAD'), idleMs)
      }
    } catch {
      await stampMtime(path.join(fixture.linked, '.git', 'HEAD'), idleMs)
    }
    const report = await runWorktreeGc({
      apply: true,
      nowMs: NOW_MS,
      idleTermMin: 60,
      coordHandle: null,
      journalDir: fixture.journalDir,
      runtime: runtimeFor(fixture.repo, fixture.linked, {
        linkedActivityAt: idleMs,
        remove: async () => {
          throw new Error('recent same-branch commit must not be removed')
        }
      }),
      listPrStates: async () => ({ ok: true, states: ['MERGED'] }),
      listProcessCwds: async () => ({ verdict: 'live', cwds: [] })
    })
    const linked = report.worktrees.find((row) => row.path === fixture.linked)
    expect(linked?.action).toBe('keep')
    expect(linked?.reasons.some((reason) => reason.includes('active<24h'))).toBe(true)
  })

  it('keeps a worktree when git metadata is newer than a stale lastActivityAt', async () => {
    const fixture = await createMergedLinkedRepo()
    roots.push(fixture.root)
    await ageGitActivity(fixture.linked, NOW_MS - 60_000, 'feature/done')
    const report = await runWorktreeGc({
      apply: true,
      nowMs: NOW_MS,
      idleTermMin: 60,
      coordHandle: null,
      journalDir: fixture.journalDir,
      runtime: runtimeFor(fixture.repo, fixture.linked, {
        linkedActivityAt: NOW_MS - DAY_MS * 2,
        remove: async () => {
          throw new Error('recent git activity must not be removed')
        }
      }),
      listPrStates: async () => ({ ok: true, states: ['MERGED'] }),
      listProcessCwds: async () => ({ verdict: 'live', cwds: [] })
    })
    const linked = report.worktrees.find((row) => row.path === fixture.linked)
    expect(linked?.action).toBe('keep')
    expect(linked?.reasons.some((reason) => reason.includes('active<24h'))).toBe(true)
  })

  it('removes an unmerged branch whose GitHub PR is MERGED or CLOSED', async () => {
    const fixture = await createMergedLinkedRepo()
    roots.push(fixture.root)
    await git(fixture.linked, ['commit', '--allow-empty', '-m', 'closed-pr'])
    await git(fixture.linked, ['push', '-u', 'origin', 'HEAD'])
    const head = await git(fixture.linked, ['rev-parse', 'HEAD'])
    await ageGitActivity(fixture.linked, NOW_MS - DAY_MS * 2, 'feature/done')
    await ageGitActivity(fixture.repo, NOW_MS - DAY_MS * 2, 'main')
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

  it('does not remove when a truncated terminal list omits an attached terminal', async () => {
    const fixture = await createMergedLinkedRepo()
    roots.push(fixture.root)
    const removed: string[] = []
    const report = await runWorktreeGc({
      apply: true,
      nowMs: NOW_MS,
      idleTermMin: 60,
      coordHandle: null,
      journalDir: fixture.journalDir,
      runtime: runtimeFor(fixture.repo, fixture.linked, {
        terminals: async () => completeGcTerminalList([], { truncated: true, totalCount: 201 }),
        remove: async (input) => {
          removed.push(input.id)
          return true
        }
      }),
      listPrStates: async () => ({ ok: true, states: ['MERGED'] }),
      listProcessCwds: async () => ({ verdict: 'live', cwds: ['/tmp/outside-workspace'] })
    })
    expect(removed).toEqual([])
    expect(existsSync(fixture.linked)).toBe(true)
    expect(report.worktrees.find((row) => row.path === fixture.linked)?.action).toBe('keep')
    expect(report.worktrees.find((row) => row.path === fixture.linked)?.reasons).toContain(
      'terminal-list-incomplete'
    )
  })

  it('does not close a terminal that becomes busy during inventory', async () => {
    const fixture = await createMergedLinkedRepo()
    roots.push(fixture.root)
    let inventoryStarted = false
    const closed: string[] = []
    const runtime = runtimeFor(fixture.repo, fixture.linked, {
      terminals: async () => [
        {
          handle: 'term-became-active',
          title: 'worker',
          worktreePath: fixture.repo,
          worktreeId: `repo::${fixture.repo}`,
          lastOutputAt: inventoryStarted ? NOW_MS : NOW_MS - 3 * 60 * 60 * 1000,
          incarnationId: 'inc-1',
          executionHostId: 'local'
        }
      ],
      closeTerminal: async (handle) => {
        closed.push(handle)
        return true
      },
      remove: async () => true
    })
    runtime.readTerminalTail = async () => (inventoryStarted ? 'Thinking' : '')
    const report = await runWorktreeGc({
      apply: true,
      nowMs: NOW_MS,
      idleTermMin: 60,
      coordHandle: null,
      journalDir: fixture.journalDir,
      runtime,
      runGit: async (cwd, args) => {
        inventoryStarted = true
        return runGitCommand(cwd, args)
      },
      listPrStates: async () => ({ ok: true, states: ['MERGED'] }),
      listProcessCwds: async () => ({ verdict: 'live', cwds: [] })
    })
    expect(closed).toEqual([])
    expect(report.terminals[0]?.action).toBe('keep')
    expect(report.terminals[0]?.why).toBe('busy')
  })

  it('does not treat unrelated branch or main-checkout activity as this worktree being active', async () => {
    const fixture = await createMergedLinkedRepo()
    roots.push(fixture.root)
    await git(fixture.repo, ['commit', '--allow-empty', '-m', 'unrelated-main'])
    await git(fixture.repo, ['push', '-u', 'origin', 'HEAD'])
    await ageGitActivity(fixture.linked, NOW_MS - DAY_MS * 2, 'feature/done')
    const removed: string[] = []
    const report = await runWorktreeGc({
      apply: true,
      nowMs: NOW_MS,
      idleTermMin: 60,
      coordHandle: null,
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
    expect(removed).toEqual([`repo::${fixture.linked}`])
    expect(report.worktrees.find((row) => row.path === fixture.linked)?.action).toBe('remove')
  })
})
