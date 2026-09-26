import { describe, expect, it, vi } from 'vitest'
import type { RuntimeClient } from './runtime-client'
import { listSavedTaskReviewRows } from './tasks-review-view'
import { startTaskReview } from './tasks-review-start'

const repos = [
  {
    id: 'repo-a',
    path: '/tmp/repo-a',
    displayName: 'A',
    badgeColor: '#000',
    addedAt: 1,
    kind: 'git',
    upstream: { owner: 'acme', repo: 'a' },
    issueSourcePreference: 'origin'
  },
  {
    id: 'repo-b',
    path: '/tmp/repo-b',
    displayName: 'B',
    badgeColor: '#000',
    addedAt: 2,
    kind: 'git',
    upstream: { owner: 'acme', repo: 'b' },
    issueSourcePreference: 'upstream'
  },
  {
    id: 'repo-c',
    path: '/tmp/repo-c',
    displayName: 'C',
    badgeColor: '#000',
    addedAt: 3,
    kind: 'git',
    upstream: { owner: 'acme', repo: 'c' }
  }
] as const

function item(number: number, repo: 'a' | 'b') {
  return {
    id: `pr:${number}`,
    type: 'pr',
    number,
    title: `Review ${repo} ${number}`,
    url: `https://github.com/acme/${repo}/pull/${number}`,
    updatedAt: '2026-09-26T00:00:00Z',
    state: 'open'
  }
}

function clientFor(args: {
  selection?: string[] | null
  activeProvider?: 'github' | 'gitlab'
  items?: Record<string, ReturnType<typeof item>[]>
  failedRepo?: string
  worktrees?: Record<string, unknown>[]
  createdWorktree?: Record<string, unknown>
}) {
  const call = vi.fn(async (method: string, params?: { repo?: string; page?: number }) => {
    if (method === 'settings.get') {
      return {
        result: {
          settings: {
            defaultRepoSelection:
              args.selection === undefined ? ['repo-a', 'repo-b'] : args.selection,
            defaultTaskSource: args.activeProvider ?? 'github',
            defaultTaskViewPreset: 'issues',
            visibleTaskProviders: ['github']
          }
        }
      }
    }
    if (method === 'ui.get') {
      return {
        result: { ui: { taskResumeState: { githubMode: 'items', githubItemsPreset: 'prs' } } }
      }
    }
    if (method === 'repo.list') {
      return { result: { repos } }
    }
    if (method === 'github.listWorkItems') {
      const repoId = params?.repo?.slice(3) ?? ''
      if (repoId === args.failedRepo) {
        throw new Error('GitHub rate limited')
      }
      const sourceName = repoId === 'repo-a' ? 'a' : 'b'
      const source = { owner: 'acme', repo: sourceName }
      const all = args.items?.[repoId] ?? [item(1, sourceName)]
      const page = params?.page ?? 1
      return {
        result: {
          items: all.slice((page - 1) * 36, page * 36),
          sources: { issues: source, prs: source, originCandidate: source, upstreamCandidate: null }
        }
      }
    }
    if (method === 'worktree.list') {
      return {
        result: {
          worktrees: args.worktrees ?? [],
          totalCount: args.worktrees?.length ?? 0,
          truncated: false,
          hostScope: { hostIds: ['local'], omittedHostIds: [] }
        }
      }
    }
    if (method === 'terminal.list') {
      return { result: { terminals: [{ handle: 'terminal-1' }], totalCount: 1, truncated: false } }
    }
    if (method === 'worktree.create') {
      return {
        result: { worktree: args.createdWorktree, agentTerminalHandle: 'grok-1', warnings: [] }
      }
    }
    throw new Error(`Unexpected RPC: ${method}`)
  })
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The test fake implements the RPC calls exercised by these functions.
  return { client: { call } as unknown as Pick<RuntimeClient, 'call'>, call }
}

describe('tasks-review', () => {
  it('uses the saved project subset and PR preset across all reachable pages', async () => {
    const many = Array.from({ length: 37 }, (_, index) => item(index + 1, 'a'))
    const { client, call } = clientFor({ items: { 'repo-a': many, 'repo-b': [item(7, 'b')] } })
    const result = await listSavedTaskReviewRows(client)
    expect(result.view).toEqual({
      provider: 'github',
      mode: 'items',
      query: 'is:pr is:open',
      selectedRepoIds: ['repo-a', 'repo-b']
    })
    expect(result.complete).toBe(true)
    expect(result.rows).toHaveLength(38)
    expect(result.rows.some((row) => row.url === 'https://github.com/acme/b/pull/7')).toBe(true)
    expect(call).toHaveBeenCalledWith('github.listWorkItems', {
      repo: 'id:repo-a',
      limit: 36,
      query: 'is:pr is:open',
      page: 2
    })
    expect(call).not.toHaveBeenCalledWith(
      'github.listWorkItems',
      expect.objectContaining({ repo: 'id:repo-c' })
    )
  })

  it('reports a partial list when one selected repo fails', async () => {
    const { client } = clientFor({ failedRepo: 'repo-b' })
    const result = await listSavedTaskReviewRows(client)
    expect(result.complete).toBe(false)
    expect(result.rows).toHaveLength(1)
    expect(result.errors).toEqual([{ repoId: 'repo-b', message: 'GitHub rate limited' }])
  })

  it('does not call a missing row absent when its repo fetch failed', async () => {
    const { client } = clientFor({ failedRepo: 'repo-b' })
    await expect(
      startTaskReview(client, { repo: 'acme/b', number: 1, type: 'pr', dryRun: true })
    ).rejects.toThrow('the saved Tasks list is partial')
  })

  it('includes later projects for a sticky-all selection', async () => {
    const { client, call } = clientFor({ selection: null })
    const result = await listSavedTaskReviewRows(client)
    expect(result.view.selectedRepoIds).toEqual(['repo-a', 'repo-b', 'repo-c'])
    expect(call).toHaveBeenCalledWith(
      'github.listWorkItems',
      expect.objectContaining({ repo: 'id:repo-c' })
    )
  })

  it('uses the saved GitHub view while another provider is active', async () => {
    const { client } = clientFor({ activeProvider: 'gitlab' })
    const result = await listSavedTaskReviewRows(client)
    expect(result.view.query).toBe('is:pr is:open')
    expect(result.complete).toBe(true)
  })

  it('prints correct PR linkage in dry-run without creating a worktree', async () => {
    const { client, call } = clientFor({})
    const result = await startTaskReview(client, {
      repo: 'acme/a',
      number: 1,
      type: 'pr',
      dryRun: true
    })
    expect(result.action).toBe('dry-run')
    if (result.action !== 'dry-run') {
      return
    }
    expect(result.payload).toMatchObject({
      repo: 'id:repo-a',
      linkedPR: 1,
      noParent: true,
      startupAgent: 'grok',
      linkedWorkItem: { type: 'pr', url: 'https://github.com/acme/a/pull/1' }
    })
    expect(call).not.toHaveBeenCalledWith('worktree.create', expect.anything())
  })

  it('returns an existing attachment without prompting its agent', async () => {
    const { client, call } = clientFor({
      worktrees: [
        {
          id: 'repo-a::/tmp/review',
          repoId: 'repo-a',
          isArchived: false,
          linkedPR: 1,
          linkedIssue: null,
          linkedWorkItem: { url: 'https://github.com/acme/a/pull/1' }
        }
      ]
    })
    const result = await startTaskReview(client, {
      repo: 'acme/a',
      number: 1,
      type: 'pr',
      dryRun: false
    })
    expect(result).toMatchObject({
      action: 'existing',
      worktreeId: 'repo-a::/tmp/review',
      terminalHandles: ['terminal-1']
    })
    expect(call).not.toHaveBeenCalledWith('worktree.create', expect.anything())
  })

  it('creates a Grok worktree with PR linkage and verifies the result', async () => {
    const { client, call } = clientFor({
      createdWorktree: {
        id: 'repo-a::/tmp/new-review',
        repoId: 'repo-a',
        linkedPR: 1,
        linkedIssue: null,
        linkedWorkItem: { type: 'pr', url: 'https://github.com/acme/a/pull/1' },
        linkedTaskSourceContext: { repoId: 'repo-a' }
      }
    })
    const result = await startTaskReview(client, {
      repo: 'acme/a',
      number: 1,
      type: 'pr',
      dryRun: false
    })
    expect(result).toMatchObject({
      action: 'created',
      worktreeId: 'repo-a::/tmp/new-review',
      terminalHandle: 'grok-1'
    })
    expect(call).toHaveBeenCalledWith(
      'worktree.create',
      expect.objectContaining({
        repo: 'id:repo-a',
        linkedPR: 1,
        noParent: true,
        startupAgent: 'grok'
      })
    )
  })
})
