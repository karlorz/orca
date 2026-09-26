import type { RuntimeClient } from './runtime-client'
import type {
  RuntimeTerminalListResult,
  RuntimeWorktreeCreateResult,
  RuntimeWorktreeListResult
} from '../shared/runtime-types'
import { WorktreeCreate } from '../shared/rpc-contract/worktree-create-params'
import { findGithubWorkItemWorkspaceAttachment } from '../shared/github-work-item-workspace-attachment'
import { hostScopeCensusIsComplete } from '../shared/runtime-listing-host-scope'
import { getLinkedWorkItemSuggestedName } from '../shared/workspace-name'
import { RuntimeClientError } from './runtime/types'
import { listSavedTaskReviewRows, type TaskReviewRow } from './tasks-review-view'

type TaskReviewClient = Pick<RuntimeClient, 'call'>

export type TaskReviewStartOptions = {
  repo: string
  repoId?: string
  number: number
  type: 'pr' | 'issue'
  dryRun: boolean
}

export async function startTaskReview(client: TaskReviewClient, options: TaskReviewStartOptions) {
  const listed = await listSavedTaskReviewRows(client)
  const matches = listed.rows.filter(
    (row) =>
      row.sourceRepo.toLowerCase() === options.repo.toLowerCase() &&
      row.number === options.number &&
      row.type === options.type &&
      (options.repoId === undefined || row.repoId === options.repoId)
  )
  if (matches.length !== 1) {
    const candidates = matches.map((row) => `${row.repoId}: ${row.url}`).join(', ')
    throw new RuntimeClientError(
      'item_not_unique',
      matches.length === 0
        ? listed.complete
          ? `No ${options.type} #${options.number} from ${options.repo} matches the saved Tasks view.`
          : `Cannot resolve ${options.type} #${options.number} from ${options.repo}; the saved Tasks list is partial: ${listed.errors.map((entry) => `${entry.repoId}: ${entry.message}`).join(', ')}`
        : `Multiple rows match; pass --repo-id. Candidates: ${candidates}`
    )
  }
  const row = matches[0]
  if (!row.taskSourceContext) {
    throw new RuntimeClientError('source_context_missing', `No Tasks source context for ${row.url}`)
  }
  const listing = (
    await client.call<RuntimeWorktreeListResult>('worktree.list', {
      repo: `id:${row.repoId}`,
      limit: 10_000
    })
  ).result
  if (listing.truncated || !hostScopeCensusIsComplete(listing.hostScope)) {
    throw new RuntimeClientError(
      'worktree_list_incomplete',
      `Cannot safely check existing worktrees for ${row.repoId}.`
    )
  }
  const attached = findGithubWorkItemWorkspaceAttachment(
    listing.worktrees,
    row.repoId,
    row.type,
    row.number
  )
  if (attached) {
    if (attached.linkedWorkItem?.url && attached.linkedWorkItem.url !== row.url) {
      throw new RuntimeClientError(
        'source_mismatch',
        `Attached worktree ${attached.id} points to ${attached.linkedWorkItem.url}, not ${row.url}.`
      )
    }
    let terminalHandles: string[] = []
    let terminalError: string | undefined
    try {
      const terminals = (
        await client.call<RuntimeTerminalListResult>('terminal.list', {
          worktree: `id:${attached.id}`,
          limit: 10_000,
          includeVisualLayouts: false
        })
      ).result
      terminalHandles = terminals.terminals.map((terminal) => terminal.handle)
      if (terminals.truncated) {
        terminalError = 'Terminal list was truncated.'
      }
    } catch (error) {
      terminalError = error instanceof Error ? error.message : String(error)
    }
    return {
      action: 'existing' as const,
      row,
      worktreeId: attached.id,
      terminalHandles,
      ...(terminalError ? { terminalError } : {})
    }
  }
  const payload = createPayload(row)
  if (options.dryRun) {
    return { action: 'dry-run' as const, row, method: 'worktree.create' as const, payload }
  }
  const created = (await client.call<RuntimeWorktreeCreateResult>('worktree.create', payload))
    .result
  const worktree = created.worktree
  const linkedNumber = row.type === 'pr' ? worktree.linkedPR : worktree.linkedIssue
  if (
    worktree.repoId !== row.repoId ||
    linkedNumber !== row.number ||
    worktree.linkedWorkItem?.type !== row.type ||
    worktree.linkedWorkItem.url !== row.url ||
    worktree.linkedTaskSourceContext?.repoId !== row.repoId
  ) {
    throw new RuntimeClientError(
      'created_link_mismatch',
      `Created worktree ${worktree.id} does not match ${row.url}; inspect it before retrying.`
    )
  }
  return {
    action: 'created' as const,
    row,
    worktreeId: worktree.id,
    terminalHandle: created.agentTerminalHandle ?? created.startupTerminal?.handle ?? null,
    warnings: created.warnings
  }
}

function createPayload(row: TaskReviewRow) {
  const slug = getLinkedWorkItemSuggestedName(row) || 'review'
  const name = `${row.type}-${row.number}-${slug}`
  const callerTerminalHandle = process.env.ORCA_TERMINAL_HANDLE
  return WorktreeCreate.parse({
    repo: `id:${row.repoId}`,
    name,
    displayName: name,
    displayNameKind: 'user',
    ...(row.type === 'pr' ? { linkedPR: row.number } : { linkedIssue: row.number }),
    linkedWorkItem: {
      provider: 'github',
      type: row.type,
      number: row.number,
      title: row.title,
      url: row.url,
      repoId: row.repoId
    },
    linkedTaskSourceContext: row.taskSourceContext,
    noParent: true,
    startupAgent: 'grok',
    startupPrompt: reviewPrompt(row),
    cliProvenanceRequest: callerTerminalHandle ? { callerTerminalHandle } : {}
  })
}

function reviewPrompt(row: TaskReviewRow): string {
  return [
    `Review GitHub ${row.type === 'pr' ? 'pull request' : 'issue'} ${row.url} from ${row.sourceRepo}.`,
    'This worktree starts from the repository default base. Use read-only GitHub commands to inspect the exact item and, for a pull request, its diff; inspect relevant local code for context.',
    'Report concrete findings with file and line evidence, then a next-step plan. If no findings, say so and identify remaining uncertainty.',
    'Do not edit files, commit, push, merge, comment on GitHub, or open a pull request.'
  ].join('\n')
}
