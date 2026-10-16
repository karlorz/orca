import { lstat, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import type { ZodType } from 'zod'
import { parseGitdirMarkerPayload } from '../shared/gitdir-marker-payload'
import { LOCAL_EXECUTION_HOST_ID } from '../shared/execution-host'
import type { RuntimeTerminalClose } from '../shared/runtime-types'
import { eraseRpcMethods } from '../main/runtime/rpc/core'
import { TERMINAL_LIFECYCLE_METHODS } from '../main/runtime/rpc/methods/terminal/terminal-lifecycle-methods'
import type { TerminalGcCloseRuntime } from '../main/runtime/rpc/methods/terminal/terminal-gc-close'
import { WORKTREE_GC_IDLE_MS } from './worktree-gc-model'
import { runGitCommand } from './worktree-gc-git'
import { runWorktreeGc } from './worktree-gc-run'
import type { WorktreeGcRuntime, WorktreeGcRuntimeWorktree } from './worktree-gc-model'
import {
  completeGcTerminalList,
  mapRuntimeTerminalList,
  terminalInventoryIsComplete
} from './worktree-gc-terminal-scope'

const DAY_MS = WORKTREE_GC_IDLE_MS
const NOW_MS = Date.parse('2026-10-15T08:00:00Z')

async function stampMtime(target: string, mtimeMs: number): Promise<void> {
  try {
    await utimes(target, mtimeMs / 1000, mtimeMs / 1000)
  } catch {
    // Missing HEAD/index is normal for a gitfile worktree.
  }
}

async function ageGitActivity(worktreePath: string, mtimeMs: number): Promise<void> {
  const gitFile = path.join(worktreePath, '.git')
  await stampMtime(worktreePath, mtimeMs)
  await stampMtime(gitFile, mtimeMs)
  await stampMtime(path.join(gitFile, 'HEAD'), mtimeMs)
  await stampMtime(path.join(gitFile, 'index'), mtimeMs)
  try {
    const info = await lstat(gitFile)
    if (!info.isFile()) {
      return
    }
    const marker = parseGitdirMarkerPayload(await readFile(gitFile, 'utf8'))
    if (!marker) {
      return
    }
    const gitdir = path.isAbsolute(marker) ? marker : path.resolve(worktreePath, marker)
    await stampMtime(path.join(gitdir, 'HEAD'), mtimeMs)
    await stampMtime(path.join(gitdir, 'index'), mtimeMs)
  } catch {
    // No git metadata to stamp.
  }
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await runGitCommand(cwd, args)
  if (result.code !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`)
  }
  return result.stdout
}

async function createMergedLinkedRepo(extraLinked = false): Promise<{
  root: string
  repo: string
  linked: string
  linkedB: string
  journalDir: string
}> {
  const root = await mkdtemp(path.join(tmpdir(), 'orca-wt-gc-apply-'))
  const repo = path.join(root, 'repo')
  const bare = path.join(root, 'repo.git')
  const linked = path.join(root, 'linked')
  const linkedB = path.join(root, 'linked-b')
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
  if (extraLinked) {
    await git(repo, ['worktree', 'add', '-b', 'feature/done-b', linkedB])
  }
  await git(repo, ['config', 'receive.denyCurrentBranch', 'ignore'])
  const idleMs = NOW_MS - DAY_MS * 2
  await ageGitActivity(repo, idleMs)
  await ageGitActivity(linked, idleMs)
  if (extraLinked) {
    await ageGitActivity(linkedB, idleMs)
  }
  return { root, repo, linked, linkedB, journalDir }
}

function worktreeRow(pathName: string, isMain: boolean): WorktreeGcRuntimeWorktree {
  return {
    id: `repo::${pathName}`,
    path: pathName,
    hostId: 'local',
    lastActivityAt: NOW_MS - DAY_MS * 2,
    isMainWorktree: isMain
  }
}

function runtimeFor(
  worktrees: WorktreeGcRuntimeWorktree[],
  options: {
    remove?: (input: { id: string; hostId: string }) => Promise<boolean>
    closeTerminal?: WorktreeGcRuntime['closeTerminal']
    terminals?: WorktreeGcRuntime['listTerminals']
  } = {}
): WorktreeGcRuntime {
  return {
    async listWorktrees() {
      return { worktrees, truncated: false }
    },
    listTerminals: options.terminals ?? (async () => completeGcTerminalList()),
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

describe('worktree gc apply revalidation', () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('does not remove after new Git activity and an unpushed HEAD appear', async () => {
    const fixture = await createMergedLinkedRepo()
    roots.push(fixture.root)
    const removed: string[] = []
    let scans = 0
    const report = await runWorktreeGc({
      apply: true,
      nowMs: NOW_MS,
      idleTermMin: 60,
      coordHandle: null,
      journalDir: fixture.journalDir,
      runtime: runtimeFor([worktreeRow(fixture.repo, true), worktreeRow(fixture.linked, false)], {
        remove: async (input) => {
          removed.push(input.id)
          return true
        }
      }),
      listPrStates: async () => ({ ok: true, states: ['MERGED'] }),
      listProcessCwds: async () => {
        scans += 1
        if (scans === 2) {
          await git(fixture.linked, ['commit', '--allow-empty', '-m', 'after-inventory'])
        }
        return { verdict: 'live', cwds: [] }
      }
    })
    expect(removed).toEqual([])
    expect(existsSync(fixture.linked)).toBe(true)
    const linked = report.worktrees.find((row) => row.path === fixture.linked)
    expect(linked?.action).toBe('keep')
    expect(linked?.reasons.some((reason) => reason.includes('UNPUSHED'))).toBe(true)
  })

  it('preserves the validated current branch tip, not the inventory head', async () => {
    const fixture = await createMergedLinkedRepo()
    roots.push(fixture.root)
    const inventoryHead = await git(fixture.linked, ['rev-parse', 'HEAD'])
    let scans = 0
    const report = await runWorktreeGc({
      apply: true,
      nowMs: NOW_MS,
      idleTermMin: 60,
      coordHandle: null,
      journalDir: fixture.journalDir,
      runtime: runtimeFor([worktreeRow(fixture.repo, true), worktreeRow(fixture.linked, false)], {
        remove: async () => {
          const result = await runGitCommand(fixture.repo, ['worktree', 'remove', fixture.linked])
          return result.code === 0
        }
      }),
      listPrStates: async () => ({ ok: true, states: ['CLOSED'] }),
      listProcessCwds: async () => {
        scans += 1
        if (scans === 2) {
          await git(fixture.linked, ['commit', '--allow-empty', '-m', 'pushed-after-inventory'])
          await git(fixture.linked, ['push', '-u', 'origin', 'HEAD'])
          await ageGitActivity(fixture.linked, NOW_MS - DAY_MS * 2)
          await ageGitActivity(fixture.repo, NOW_MS - DAY_MS * 2)
        }
        return { verdict: 'live', cwds: [] }
      }
    })
    const linked = report.worktrees.find((row) => row.path === fixture.linked)
    expect(linked?.action).toBe('remove')
    expect(linked?.head).not.toBe(inventoryHead)
    expect(await git(fixture.repo, ['rev-parse', 'refs/orca-gc/feature/done'])).toBe(linked?.head)
    expect(linked?.head).toBeDefined()
  })

  it('keeps a later candidate when a process appears in it during an earlier removal', async () => {
    const fixture = await createMergedLinkedRepo(true)
    roots.push(fixture.root)
    const removed: string[] = []
    let scans = 0
    const report = await runWorktreeGc({
      apply: true,
      nowMs: NOW_MS,
      idleTermMin: 60,
      coordHandle: null,
      journalDir: fixture.journalDir,
      runtime: runtimeFor(
        [
          worktreeRow(fixture.repo, true),
          worktreeRow(fixture.linked, false),
          worktreeRow(fixture.linkedB, false)
        ],
        {
          remove: async (input) => {
            removed.push(input.id)
            return true
          }
        }
      ),
      listPrStates: async () => ({ ok: true, states: ['MERGED'] }),
      listProcessCwds: async () => {
        scans += 1
        if (scans >= 3) {
          return { verdict: 'live', cwds: [fixture.linkedB] }
        }
        return { verdict: 'live', cwds: [] }
      }
    })
    expect(removed).toEqual([`repo::${fixture.linked}`])
    expect(report.worktrees.find((row) => row.path === fixture.linked)?.action).toBe('remove')
    expect(report.worktrees.find((row) => row.path === fixture.linkedB)?.action).toBe('keep')
    expect(report.worktrees.find((row) => row.path === fixture.linkedB)?.reasons).toContain(
      'process-cwd-inside'
    )
  })

  it('treats a complete global terminal inventory as complete after --repo filtering', () => {
    const selected = worktreeRow('/repo-a', true)
    const mapped = mapRuntimeTerminalList(
      {
        terminals: [
          {
            handle: 'term_a',
            ptyId: 'pty-a',
            worktreeId: selected.id,
            worktreePath: selected.path,
            branch: 'main',
            tabId: 'tab-a',
            leafId: 'leaf-a',
            title: 'A',
            connected: true,
            writable: true,
            lastOutputAt: 1,
            preview: '',
            incarnationId: 'inc-a',
            executionHostId: LOCAL_EXECUTION_HOST_ID
          },
          {
            handle: 'term_b',
            ptyId: 'pty-b',
            worktreeId: 'wt-b',
            worktreePath: '/repo-b',
            branch: 'main',
            tabId: 'tab-b',
            leafId: 'leaf-b',
            title: 'B',
            connected: true,
            writable: true,
            lastOutputAt: 1,
            preview: '',
            incarnationId: 'inc-b',
            executionHostId: LOCAL_EXECUTION_HOST_ID
          }
        ],
        totalCount: 2,
        truncated: false,
        hostScope: { hostIds: [LOCAL_EXECUTION_HOST_ID], omittedHostIds: [] }
      },
      [selected]
    )
    expect(mapped.terminals.map((terminal) => terminal.handle)).toEqual(['term_a'])
    expect(terminalInventoryIsComplete(mapped)).toBe(true)
  })

  it('still removes an eligible selected-repo worktree when another repo has terminals', async () => {
    const fixture = await createMergedLinkedRepo()
    roots.push(fixture.root)
    const removed: string[] = []
    const report = await runWorktreeGc({
      apply: true,
      nowMs: NOW_MS,
      idleTermMin: 60,
      coordHandle: null,
      journalDir: fixture.journalDir,
      runtime: runtimeFor([worktreeRow(fixture.repo, true), worktreeRow(fixture.linked, false)], {
        terminals: async () =>
          mapRuntimeTerminalList(
            {
              terminals: [
                {
                  handle: 'term_other',
                  ptyId: 'pty-o',
                  worktreeId: 'other',
                  worktreePath: '/other-repo',
                  branch: 'main',
                  tabId: 'tab-o',
                  leafId: 'leaf-o',
                  title: 'other',
                  connected: true,
                  writable: true,
                  lastOutputAt: 1,
                  preview: '',
                  incarnationId: 'inc-o',
                  executionHostId: LOCAL_EXECUTION_HOST_ID
                }
              ],
              totalCount: 1,
              truncated: false,
              hostScope: { hostIds: [LOCAL_EXECUTION_HOST_ID], omittedHostIds: [] }
            },
            [worktreeRow(fixture.repo, true), worktreeRow(fixture.linked, false)]
          ),
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

  it('refuses close through the real RPC handler when incarnation changes during re-read', async () => {
    const fixture = await createMergedLinkedRepo()
    roots.push(fixture.root)
    let incarnationId = 'inc-old'
    let lastOutputAt = NOW_MS - 3 * 60 * 60 * 1000
    let tail = ''
    const closed: { handle: string; expectedIncarnationId?: string }[] = []
    const host: TerminalGcCloseRuntime & { getRuntimeId: () => string } = {
      getRuntimeId: () => 'runtime-test',
      async listTerminals() {
        return {
          terminals: [
            {
              handle: 'term_idle',
              ptyId: 'pty-1',
              incarnationId,
              worktreeId: `repo::${fixture.repo}`,
              worktreePath: fixture.repo,
              branch: 'main',
              tabId: 'tab-1',
              leafId: 'leaf-1',
              title: 'idle',
              connected: true,
              writable: true,
              lastOutputAt,
              preview: ''
            }
          ],
          totalCount: 1,
          truncated: false,
          hostScope: { hostIds: ['local'], omittedHostIds: [] }
        }
      },
      async readTerminal() {
        incarnationId = 'inc-new'
        tail = 'new task started'
        return {
          handle: 'term_idle',
          status: 'running',
          tail: [tail],
          truncated: false,
          nextCursor: null
        }
      },
      async closeTerminal(handle, options) {
        closed.push({ handle, expectedIncarnationId: options?.expectedIncarnationId })
        return { handle, tabId: 'tab-1', ptyKilled: true }
      }
    }
    const method = eraseRpcMethods(TERMINAL_LIFECYCLE_METHODS).find(
      (entry) => entry.name === 'terminal.close'
    )
    if (!method) {
      throw new Error('terminal.close is not registered')
    }
    const report = await runWorktreeGc({
      apply: true,
      nowMs: NOW_MS,
      idleTermMin: 60,
      coordHandle: null,
      journalDir: fixture.journalDir,
      runtime: runtimeFor([worktreeRow(fixture.repo, true), worktreeRow(fixture.linked, false)], {
        terminals: async () =>
          completeGcTerminalList([
            {
              handle: 'term_idle',
              title: 'idle',
              worktreePath: fixture.repo,
              worktreeId: `repo::${fixture.repo}`,
              lastOutputAt: NOW_MS - 3 * 60 * 60 * 1000,
              incarnationId: 'inc-old',
              executionHostId: 'local'
            }
          ]),
        closeTerminal: async (handle, expectedIncarnationId, idleTermMin, coordHandle) => {
          const parsed = (method.params as ZodType).parse({
            terminal: handle,
            ...(expectedIncarnationId ? { expectedIncarnationId } : {}),
            ...(typeof idleTermMin === 'number' ? { gcIdleTermMin: idleTermMin } : {}),
            ...(coordHandle ? { gcCoordHandle: coordHandle } : {})
          })
          const result = (await method.handler(parsed, { runtime: host } as never)) as {
            close: RuntimeTerminalClose
          }
          return Boolean(result.close.handle)
        },
        remove: async () => true
      }),
      listPrStates: async () => ({ ok: true, states: ['MERGED'] }),
      listProcessCwds: async () => ({ verdict: 'live', cwds: [] })
    })
    expect(closed).toEqual([])
    expect(report.terminals[0]?.action).toBe('keep')
    expect(report.terminals[0]?.why).toBe('gc-close-refused')
  })
})
