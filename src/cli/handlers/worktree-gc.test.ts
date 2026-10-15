import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HandlerContext } from '../dispatch'
import { RuntimeClientError } from '../runtime-client'
import type { RuntimeRpcSuccess } from '../../shared/runtime-rpc-envelope'
import { COMMAND_SPECS } from '../specs'
import { parseArgs, validateCommandAndFlags } from '../args'
import { WORKTREE_GC_HANDLERS } from './worktree-gc'

function gcHandlerContext(
  flags: Map<string, string | boolean>,
  call: ReturnType<typeof vi.fn>,
  options: { isRemote?: boolean } = {}
): HandlerContext {
  return {
    flags,
    cwd: '/tmp',
    json: true,
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: worktree gc only reads client.call and client.isRemote.
    client: { call, isRemote: options.isRemote ?? false } as never
  }
}

describe('worktree gc CLI', () => {
  const dirs: string[] = []

  afterEach(async () => {
    vi.restoreAllMocks()
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('accepts the dry-run default and --apply, and lists --force as a refused flag', () => {
    const spec = COMMAND_SPECS.find((item) => item.path.join(' ') === 'worktree gc')
    expect(spec).toBeDefined()
    expect(spec?.allowedFlags).toContain('apply')
    expect(spec?.allowedFlags).toContain('force')
    const parsed = parseArgs(['worktree', 'gc', '--json'], undefined, COMMAND_SPECS)
    expect(() => validateCommandAndFlags(COMMAND_SPECS, parsed)).not.toThrow()
    const apply = parseArgs(['worktree', 'gc', '--apply', '--json'], undefined, COMMAND_SPECS)
    expect(apply.flags.get('apply')).toBe(true)
    expect(() => validateCommandAndFlags(COMMAND_SPECS, apply)).not.toThrow()
  })

  it('refuses --force before any inventory or removal', async () => {
    const call = vi.fn()
    await expect(
      WORKTREE_GC_HANDLERS['worktree gc'](gcHandlerContext(new Map([['force', true]]), call))
    ).rejects.toMatchObject({
      code: 'invalid_argument'
    })
    expect(call).not.toHaveBeenCalled()
  })

  it('dry-run does not close terminals or remove worktrees', async () => {
    const journalDir = await mkdtemp(path.join(tmpdir(), 'orca-wt-gc-cli-'))
    dirs.push(journalDir)
    const call = vi.fn(async (method: string): Promise<RuntimeRpcSuccess<unknown>> => {
      if (method === 'worktree.list') {
        return {
          id: 'list',
          ok: true as const,
          result: { worktrees: [], totalCount: 0, truncated: false },
          _meta: { runtimeId: 'runtime-1' }
        }
      }
      if (method === 'terminal.list') {
        return {
          id: 'terms',
          ok: true as const,
          result: {
            terminals: [],
            totalCount: 0,
            truncated: false,
            hostScope: { hostIds: ['local'], omittedHostIds: [] }
          },
          _meta: { runtimeId: 'runtime-1' }
        }
      }
      throw new Error(`unexpected ${method}`)
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await WORKTREE_GC_HANDLERS['worktree gc'](
      gcHandlerContext(new Map([['journal-dir', journalDir]]), call)
    )
    expect(call).not.toHaveBeenCalledWith('worktree.rm', expect.anything())
    expect(call).not.toHaveBeenCalledWith('terminal.close', expect.anything())
    expect(call).toHaveBeenCalledWith(
      'terminal.list',
      expect.objectContaining({ includeVisualLayouts: false, limit: 10_000 })
    )
  })

  it('with --repo closes only terminals for the selected repository', async () => {
    const journalDir = await mkdtemp(path.join(tmpdir(), 'orca-wt-gc-cli-'))
    dirs.push(journalDir)
    const closed: string[] = []
    const call = vi.fn(
      async (
        method: string,
        params?: { terminal?: string }
      ): Promise<RuntimeRpcSuccess<unknown>> => {
        if (method === 'worktree.list') {
          return {
            id: 'list',
            ok: true as const,
            result: {
              worktrees: [
                {
                  id: 'wt-a',
                  path: '/tmp/repo-a-gc',
                  hostId: 'local',
                  lastActivityAt: 1,
                  isMainWorktree: true
                }
              ],
              totalCount: 1,
              truncated: false
            },
            _meta: { runtimeId: 'runtime-1' }
          }
        }
        if (method === 'terminal.list') {
          return {
            id: 'terms',
            ok: true as const,
            result: {
              terminals: [
                {
                  handle: 'term_a',
                  title: 'A',
                  worktreePath: '/tmp/repo-a-gc',
                  worktreeId: 'wt-a',
                  lastOutputAt: 1,
                  incarnationId: 'inc-a',
                  executionHostId: 'local'
                },
                {
                  handle: 'term_b',
                  title: 'B',
                  worktreePath: '/tmp/repo-b-gc',
                  worktreeId: 'wt-b',
                  lastOutputAt: 1,
                  incarnationId: 'inc-b',
                  executionHostId: 'local'
                }
              ],
              totalCount: 2,
              truncated: false,
              hostScope: { hostIds: ['local'], omittedHostIds: [] }
            },
            _meta: { runtimeId: 'runtime-1' }
          }
        }
        if (method === 'terminal.read') {
          return {
            id: 'read',
            ok: true as const,
            result: { terminal: { tail: [] } },
            _meta: { runtimeId: 'runtime-1' }
          }
        }
        if (method === 'terminal.close') {
          closed.push(params?.terminal ?? '')
          return {
            id: 'close',
            ok: true as const,
            result: { close: { handle: params?.terminal } },
            _meta: { runtimeId: 'runtime-1' }
          }
        }
        throw new Error(`unexpected ${method}`)
      }
    )
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await WORKTREE_GC_HANDLERS['worktree gc'](
      gcHandlerContext(
        new Map<string, string | boolean>([
          ['apply', true],
          ['repo', 'repo-a'],
          ['journal-dir', journalDir]
        ]),
        call
      )
    )
    expect(closed).toEqual(['term_a'])
    expect(call).not.toHaveBeenCalledWith(
      'terminal.close',
      expect.objectContaining({ terminal: 'term_b' })
    )
    expect(call).not.toHaveBeenCalledWith(
      'terminal.read',
      expect.objectContaining({ terminal: 'term_b' })
    )
    expect(call).toHaveBeenCalledWith(
      'terminal.close',
      expect.objectContaining({ terminal: 'term_a', expectedIncarnationId: 'inc-a' })
    )
  })

  it('rejects a remote client before inventory or process scans', async () => {
    const call = vi.fn()
    await expect(
      WORKTREE_GC_HANDLERS['worktree gc'](
        gcHandlerContext(new Map([['apply', true]]), call, { isRemote: true })
      )
    ).rejects.toMatchObject({
      code: 'invalid_environment'
    })
    expect(call).not.toHaveBeenCalled()
  })

  it('with --repo does not close a same-path terminal from another host', async () => {
    const journalDir = await mkdtemp(path.join(tmpdir(), 'orca-wt-gc-cli-'))
    dirs.push(journalDir)
    const closed: string[] = []
    const call = vi.fn(
      async (
        method: string,
        params?: { terminal?: string }
      ): Promise<RuntimeRpcSuccess<unknown>> => {
        if (method === 'worktree.list') {
          return {
            id: 'list',
            ok: true as const,
            result: {
              worktrees: [
                {
                  id: 'a::/repo',
                  path: '/repo',
                  hostId: 'local',
                  lastActivityAt: 1,
                  isMainWorktree: true
                }
              ],
              totalCount: 1,
              truncated: false
            },
            _meta: { runtimeId: 'runtime-1' }
          }
        }
        if (method === 'terminal.list') {
          return {
            id: 'terms',
            ok: true as const,
            result: {
              terminals: [
                {
                  handle: 'term-repo-B',
                  title: 'B',
                  worktreePath: '/repo',
                  worktreeId: 'b::/repo',
                  lastOutputAt: 1,
                  incarnationId: 'inc-b',
                  executionHostId: 'ssh:other'
                }
              ],
              totalCount: 1,
              truncated: false,
              hostScope: { hostIds: ['local', 'ssh:other'], omittedHostIds: [] }
            },
            _meta: { runtimeId: 'runtime-1' }
          }
        }
        if (method === 'terminal.read') {
          return {
            id: 'read',
            ok: true as const,
            result: { terminal: { tail: [] } },
            _meta: { runtimeId: 'runtime-1' }
          }
        }
        if (method === 'terminal.close') {
          closed.push(params?.terminal ?? '')
          return {
            id: 'close',
            ok: true as const,
            result: { close: { handle: params?.terminal } },
            _meta: { runtimeId: 'runtime-1' }
          }
        }
        throw new Error(`unexpected ${method}`)
      }
    )
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await WORKTREE_GC_HANDLERS['worktree gc'](
      gcHandlerContext(
        new Map<string, string | boolean>([
          ['apply', true],
          ['repo', 'repo-a'],
          ['journal-dir', journalDir]
        ]),
        call
      )
    )
    expect(closed).toEqual([])
    expect(call).not.toHaveBeenCalledWith(
      'terminal.close',
      expect.objectContaining({ terminal: 'term-repo-B' })
    )
    expect(call).not.toHaveBeenCalledWith(
      'terminal.read',
      expect.objectContaining({ terminal: 'term-repo-B' })
    )
  })

  it('turns --force into the explicit never-force error code', async () => {
    try {
      await WORKTREE_GC_HANDLERS['worktree gc'](
        gcHandlerContext(
          new Map([
            ['apply', true],
            ['force', true]
          ]),
          vi.fn()
        )
      )
      throw new Error('expected --force to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(RuntimeClientError)
      if (error instanceof RuntimeClientError) {
        expect(error.message).toContain('never uses --force')
      }
    }
  })
})
