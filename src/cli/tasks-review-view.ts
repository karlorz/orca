import type { RuntimeClient } from './runtime-client'
import type { GlobalSettings } from '../shared/global-settings-types'
import type { PersistedUIState } from '../shared/persisted-ui-state-types'
import type { Repo } from '../shared/repo-types'
import type { GitHubWorkItem, ListWorkItemsResult } from '../shared/github/work-item-types'
import type { GitHubOwnerRepo } from '../shared/github/pull-request-types'
import type { TaskSourceContext } from '../shared/task-source-context'
import { getTaskPageRepoSourceContext } from '../shared/task-page-source-context'
import {
  getDefaultTaskRepoSelection,
  getTaskEligibleRepos,
  normalizeTaskRepoSelection
} from '../shared/task-page-default-repo-selection'
import { getTaskPresetQuery } from '../shared/task-preset-query'
import { parseTaskQuery, stripRepoQualifiers } from '../shared/task-query'
import { normalizeVisibleTaskProviders } from '../shared/task-providers'
import { RuntimeClientError } from './runtime/types'

type TaskReviewClient = Pick<RuntimeClient, 'call'>
type MainWorkItem = Omit<GitHubWorkItem, 'repoId'>
type ViewSettings = Pick<
  GlobalSettings,
  'defaultRepoSelection' | 'defaultTaskViewPreset' | 'visibleTaskProviders'
>

export type TaskReviewRow = {
  repoId: string
  sourceRepo: string
  source: GitHubOwnerRepo
  number: number
  type: 'pr' | 'issue'
  title: string
  url: string
  updated: string
  taskSourceContext: TaskSourceContext | null
}

export type TaskReviewList = {
  view: { provider: 'github'; mode: 'items'; query: string; selectedRepoIds: string[] }
  complete: boolean
  rows: TaskReviewRow[]
  errors: { repoId: string; message: string }[]
}

const PAGE_SIZE = 36
const MAX_PAGES_PER_REPO = 30
const CONCURRENT_REPOS = 4

export async function listSavedTaskReviewRows(client: TaskReviewClient): Promise<TaskReviewList> {
  const [settingsResponse, uiResponse, repoResponse] = await Promise.all([
    client.call<{ settings: ViewSettings }>('settings.get'),
    client.call<{ ui: Pick<PersistedUIState, 'taskResumeState'> }>('ui.get'),
    client.call<{ repos: Repo[] }>('repo.list')
  ])
  const settings = settingsResponse.result.settings
  const resume = uiResponse.result.ui.taskResumeState
  const visible = normalizeVisibleTaskProviders(settings.visibleTaskProviders)
  // Why: switching Tasks to another provider does not erase the saved GitHub Items view.
  if (!visible.includes('github')) {
    throw new RuntimeClientError('unsupported_view', 'GitHub is hidden from saved Tasks providers.')
  }
  if ((resume?.githubMode ?? 'items') !== 'items') {
    throw new RuntimeClientError(
      'unsupported_view',
      'Saved GitHub Tasks mode is Project, not Items.'
    )
  }
  const preset = resume?.githubItemsPreset
  const query =
    preset === null
      ? (resume?.githubItemsQuery ?? '')
      : getTaskPresetQuery(
          preset === 'all' ? 'issues' : (preset ?? settings.defaultTaskViewPreset ?? 'issues')
        )
  const eligible = getTaskEligibleRepos(repoResponse.result.repos)
  const selectedIds = Array.isArray(settings.defaultRepoSelection)
    ? normalizeTaskRepoSelection(eligible, new Set(settings.defaultRepoSelection))
    : getDefaultTaskRepoSelection(eligible)
  const selected = eligible.filter((repo) => selectedIds.has(repo.id))
  const rows: TaskReviewRow[] = []
  const errors: TaskReviewList['errors'] = []
  const fetchQuery = stripRepoQualifiers(query.trim())
  const scope = parseTaskQuery(fetchQuery).scope
  for (let index = 0; index < selected.length; index += CONCURRENT_REPOS) {
    const batch = await Promise.all(
      selected
        .slice(index, index + CONCURRENT_REPOS)
        .map((repo) => listRepoRows(client, repo, fetchQuery, scope))
    )
    for (const result of batch) {
      rows.push(...result.rows)
      errors.push(...result.errors)
    }
  }
  rows.sort((left, right) => right.number - left.number || left.repoId.localeCompare(right.repoId))
  return {
    view: { provider: 'github', mode: 'items', query, selectedRepoIds: selected.map((r) => r.id) },
    complete: errors.length === 0,
    rows,
    errors
  }
}

async function listRepoRows(
  client: TaskReviewClient,
  repo: Repo,
  query: string,
  scope: ReturnType<typeof parseTaskQuery>['scope']
): Promise<Pick<TaskReviewList, 'rows' | 'errors'>> {
  const rows: TaskReviewRow[] = []
  const errors: TaskReviewList['errors'] = []
  const context = getTaskPageRepoSourceContext(repo, 'github')
  const seen = new Set<string>()
  for (let page = 1; page <= MAX_PAGES_PER_REPO; page += 1) {
    let result: ListWorkItemsResult<MainWorkItem>
    try {
      result = (
        await client.call<ListWorkItemsResult<MainWorkItem>>('github.listWorkItems', {
          repo: `id:${repo.id}`,
          limit: PAGE_SIZE,
          query,
          page
        })
      ).result
    } catch (error) {
      errors.push({ repoId: repo.id, message: describeError(error) })
      break
    }
    const relevantErrors = [
      ...(scope !== 'pr' && result.errors?.issues ? [result.errors.issues.message] : []),
      ...(scope !== 'issue' && result.errors?.prs ? [result.errors.prs.message] : [])
    ]
    for (const message of relevantErrors) {
      errors.push({ repoId: repo.id, message })
    }
    for (const item of result.items) {
      const source = item.type === 'pr' ? result.sources.prs : result.sources.issues
      if (!source) {
        errors.push({
          repoId: repo.id,
          message: `Missing ${item.type} source for #${item.number}`
        })
        continue
      }
      const sourceRepo = sourceRepoName(source)
      const key = `${sourceRepo}:${item.type}:${item.number}`
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      rows.push({
        repoId: repo.id,
        sourceRepo,
        source,
        number: item.number,
        type: item.type,
        title: item.title,
        url: item.url,
        updated: item.updatedAt,
        taskSourceContext: context
      })
    }
    if (relevantErrors.length > 0 || result.items.length < PAGE_SIZE) {
      break
    }
    if (page === MAX_PAGES_PER_REPO) {
      errors.push({ repoId: repo.id, message: 'GitHub search result window reached.' })
    }
  }
  return { rows, errors }
}

function sourceRepoName(source: GitHubOwnerRepo): string {
  return source.host && source.host !== 'github.com'
    ? `${source.host}/${source.owner}/${source.repo}`
    : `${source.owner}/${source.repo}`
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
