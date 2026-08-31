import { appendFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { loadUpstreamReleases, selectLatestTrains } from './fork-upstream-trains.mjs'
import { parseUpstreamMobileBase, resolveForkMobileAppJson } from './fork-next-mobile-tag.mjs'
import {
  FORK_WORKING_BRANCH,
  FORK_MIRROR_BRANCH,
  UPSTREAM_REPO,
  UPSTREAM_GIT_URL,
  UPSTREAM_BRANCH,
  assertSafePushRemoteUrl,
  resolvePushRemote,
  listGitRemotes
} from './fork-git-remote.mjs'

export {
  FORK_WORKING_BRANCH,
  FORK_MIRROR_BRANCH,
  UPSTREAM_REPO,
  UPSTREAM_GIT_URL,
  UPSTREAM_BRANCH,
  assertSafePushRemoteUrl,
  resolvePushRemote,
  listGitRemotes
}

export function buildForkMainSyncPlan() {
  return {
    mirrorBranch: FORK_MIRROR_BRANCH,
    workingBranch: FORK_WORKING_BRANCH,
    upstreamRepo: UPSTREAM_REPO,
    upstreamUrl: UPSTREAM_GIT_URL,
    upstreamBranch: UPSTREAM_BRANCH,
    fetchArgs: ['fetch', UPSTREAM_GIT_URL, UPSTREAM_BRANCH],
    mergeArgs: [
      'merge',
      '--no-ff',
      'FETCH_HEAD',
      '-m',
      'merge: sync fork-main from stablyai/orca main'
    ],
    neverMergeUpstreamApiOnWorkingBranch: true
  }
}

function git(args, options = {}) {
  const result = spawnSync('git', args, {
    encoding: 'utf8',
    cwd: options.cwd,
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe']
  })
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim()
    throw new Error(`git ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`)
  }
  return (result.stdout ?? '').trim()
}

export function appendGitHubOutput(outputPath, values) {
  if (!outputPath) {
    return
  }
  const body = Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
  appendFileSync(outputPath, `${body}\n`)
}

export function isAutoResolvableSyncConflict(unmergedPaths) {
  return (
    Array.isArray(unmergedPaths) &&
    unmergedPaths.length === 1 &&
    unmergedPaths[0] === 'mobile/app.json'
  )
}

function resolveMobileAppJsonMergeConflict({ cwd }) {
  const unmerged = git(['diff', '--name-only', '--diff-filter=U'], { cwd })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  if (!isAutoResolvableSyncConflict(unmerged)) {
    throw new Error(`Unresolvable fork-sync conflicts: ${unmerged.join(', ') || '(none)'}`)
  }
  const trains = selectLatestTrains(loadUpstreamReleases())
  if (!trains.mobile?.tag) {
    throw new Error('No upstream mobile train to resolve mobile/app.json')
  }
  const trainBase = parseUpstreamMobileBase(trains.mobile.tag)
  const ours = JSON.parse(git(['show', ':2:mobile/app.json'], { cwd }))
  const theirs = JSON.parse(git(['show', ':3:mobile/app.json'], { cwd }))
  const resolved = resolveForkMobileAppJson({ ours, theirs, trainBase })
  writeFileSync(
    join(cwd ?? process.cwd(), 'mobile/app.json'),
    `${JSON.stringify(resolved, null, 2)}\n`
  )
  git(['add', 'mobile/app.json'], { cwd })
  git(['commit', '--no-edit'], { cwd })
}

export function syncForkMainFromUpstream({ cwd, write = false } = {}) {
  const plan = buildForkMainSyncPlan()
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd })
  if (branch !== plan.workingBranch) {
    throw new Error(`Must run on ${plan.workingBranch}, currently ${branch}`)
  }
  const pushRemote = resolvePushRemote(listGitRemotes(cwd))
  if (!write) {
    return { ...plan, pushRemote, wrote: false }
  }

  git(plan.fetchArgs, { cwd })
  const before = git(['rev-parse', 'HEAD'], { cwd })
  try {
    git(plan.mergeArgs, { cwd })
  } catch (error) {
    let unmerged = []
    try {
      unmerged = git(['diff', '--name-only', '--diff-filter=U'], { cwd })
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    } catch {
      throw error
    }
    if (!isAutoResolvableSyncConflict(unmerged)) {
      throw error
    }
    resolveMobileAppJsonMergeConflict({ cwd })
  }
  const after = git(['rev-parse', 'HEAD'], { cwd })
  if (before !== after) {
    git(['push', pushRemote, `HEAD:${plan.workingBranch}`], { cwd })
  }
  const pushed = before !== after
  appendGitHubOutput(process.env.GITHUB_OUTPUT, { before, after, pushed: String(pushed) })
  return { ...plan, pushRemote, wrote: true, before, after, pushed }
}

const invokedDirectly =
  Boolean(process.argv[1]) && process.argv[1].endsWith('fork-sync-fork-main.mjs')

if (invokedDirectly) {
  const write = process.argv.includes('--write')
  const result = syncForkMainFromUpstream({ write })
  console.log(
    write
      ? `fork-main sync ${result.pushed ? 'pushed' : 'already up to date'} via ${result.pushRemote}`
      : `dry-run: would fetch ${result.upstreamUrl} ${result.upstreamBranch} and merge into ${result.workingBranch}`
  )
}
