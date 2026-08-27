import { spawnSync } from 'node:child_process'

export const FORK_WORKING_BRANCH = 'fork-main'
export const FORK_MIRROR_BRANCH = 'main'
export const UPSTREAM_REPO = 'stablyai/orca'
export const UPSTREAM_GIT_URL = 'https://github.com/stablyai/orca.git'
export const UPSTREAM_BRANCH = 'main'

export function assertSafePushRemoteUrl(remoteUrl) {
  const url = String(remoteUrl ?? '')
  if (!url) {
    throw new Error('Push remote URL is required')
  }
  if (url.includes('stablyai/orca')) {
    throw new Error('Refusing to push to stablyai/orca')
  }
  if (!url.includes('karlorz/orca')) {
    throw new Error(`Push remote must be karlorz/orca, got: ${url}`)
  }
}

export function resolvePushRemote(remotes) {
  const rows = Array.isArray(remotes) ? remotes : []
  const named = (name) => rows.find((row) => row?.name === name)
  const fork = named('fork')
  if (fork) {
    assertSafePushRemoteUrl(fork.url)
    return fork.name
  }
  const origin = named('origin')
  if (origin) {
    assertSafePushRemoteUrl(origin.url)
    return origin.name
  }
  throw new Error('No karlorz/orca push remote (fork or origin)')
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

export function listGitRemotes(cwd) {
  const stdout = git(['remote', '-v'], { cwd })
  const remotes = []
  for (const line of stdout.split('\n')) {
    const match = /^(?<name>\S+)\s+(?<url>\S+)\s+\(push\)$/.exec(line)
    if (match?.groups) {
      remotes.push({ name: match.groups.name, url: match.groups.url })
    }
  }
  return remotes
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
  git(plan.mergeArgs, { cwd })
  const after = git(['rev-parse', 'HEAD'], { cwd })
  if (before !== after) {
    git(['push', pushRemote, `HEAD:${plan.workingBranch}`], { cwd })
  }
  return { ...plan, pushRemote, wrote: true, before, after, pushed: before !== after }
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
