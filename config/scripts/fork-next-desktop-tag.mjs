import { spawnSync } from 'node:child_process'
import {
  assertSafePushRemoteUrl,
  FORK_WORKING_BRANCH,
  listGitRemotes,
  resolvePushRemote,
  UPSTREAM_GIT_URL
} from './fork-git-remote.mjs'
import { loadUpstreamReleases, selectLatestTrains } from './fork-upstream-trains.mjs'

const UPSTREAM_DESKTOP_TAG = /^v(\d+\.\d+\.\d+)(?:-rc\.\d+)?$/
const FORK_DESKTOP_TAG = /^v(\d+\.\d+\.\d+)-(\d+)$/

export function parseUpstreamDesktopBase(tag) {
  const match = UPSTREAM_DESKTOP_TAG.exec(String(tag ?? '').trim())
  if (!match) {
    throw new Error(`Tag is not a valid upstream desktop release tag: ${tag}`)
  }
  return match[1]
}

export function parseSemverParts(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version ?? '').trim())
  if (!match) {
    throw new Error(`Invalid semver base: ${version}`)
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

export function compareSemverBases(a, b) {
  const [aMaj, aMin, aPatch] = parseSemverParts(a)
  const [bMaj, bMin, bPatch] = parseSemverParts(b)
  return aMaj - bMaj || aMin - bMin || aPatch - bPatch
}

export function nextForkSuffix(existingForkTagNames, base) {
  const cleanBase = parseUpstreamDesktopBase(`v${base.replace(/^v/, '')}`)
  let maxSuffix = -1
  for (const rawTag of existingForkTagNames ?? []) {
    const tagName = String(rawTag ?? '').replace(/^refs\/tags\//, '')
    const match = FORK_DESKTOP_TAG.exec(tagName)
    if (match && match[1] === cleanBase) {
      const suffix = Number(match[2])
      if (suffix > maxSuffix) {
        maxSuffix = suffix
      }
    }
  }
  return maxSuffix + 1
}

export function buildNextDesktopTagPlan({ upstreamTag, forkTags }) {
  const base = parseUpstreamDesktopBase(upstreamTag)
  const tagList = Array.isArray(forkTags) ? forkTags : []

  for (const rawTag of tagList) {
    const tagName = String(rawTag ?? '').replace(/^refs\/tags\//, '')
    const match = FORK_DESKTOP_TAG.exec(tagName)
    if (match) {
      const existingBase = match[1]
      if (compareSemverBases(base, existingBase) < 0) {
        throw new Error(
          `Refusing base ${base} lower than existing fork base ${existingBase} from tag ${tagName}`
        )
      }
    }
  }

  const suffix = nextForkSuffix(tagList, base)
  const nextTag = `v${base}-${suffix}`
  return {
    upstreamTag,
    base,
    suffix,
    nextTag,
    tagRef: `refs/tags/${nextTag}`
  }
}

export function buildAutoCutPlan({ upstreamTag, forkTags }) {
  const base = parseUpstreamDesktopBase(upstreamTag)
  const tagList = Array.isArray(forkTags) ? forkTags : []

  let highest = null
  for (const rawTag of tagList) {
    const tagName = String(rawTag ?? '').replace(/^refs\/tags\//, '')
    const match = FORK_DESKTOP_TAG.exec(tagName)
    if (match && (highest === null || compareSemverBases(match[1], highest) > 0)) {
      highest = match[1]
    }
  }

  if (highest !== null && compareSemverBases(base, highest) <= 0) {
    return {
      cut: false,
      reason: `base ${base} already covered by fork desktop tag base ${highest}`,
      upstreamTag,
      base
    }
  }

  const nextTag = `v${base}-0`
  return { cut: true, upstreamTag, base, suffix: 0, nextTag, tagRef: `refs/tags/${nextTag}` }
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

export function listRemoteTags(remoteUrl, { cwd } = {}) {
  const stdout = git(['ls-remote', '--tags', remoteUrl], { cwd })
  const tags = []
  for (const line of stdout.split('\n')) {
    const match = /^\S+\s+(refs\/tags\/\S+)$/.exec(line.trim())
    if (match) {
      const ref = match[1]
      if (!ref.endsWith('^{}')) {
        tags.push(ref.replace(/^refs\/tags\//, ''))
      }
    }
  }
  return tags
}

export function listLocalTags({ cwd } = {}) {
  const stdout = git(['tag', '-l'], { cwd })
  return stdout
    ? stdout
        .split('\n')
        .map((tag) => tag.trim())
        .filter(Boolean)
    : []
}

export function assertSafeWorkingTreeForTag({ cwd, pushRemote }) {
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd })
  if (branch !== FORK_WORKING_BRANCH) {
    throw new Error(`Must be on ${FORK_WORKING_BRANCH}, currently on ${branch}`)
  }

  const status = git(['status', '--porcelain'], { cwd })
  if (status.length > 0) {
    throw new Error('Working tree is not clean')
  }

  git(['fetch', UPSTREAM_GIT_URL, 'main'], { cwd })
  const mergeBase = git(['merge-base', 'FETCH_HEAD', 'HEAD'], { cwd })
  const fetchHead = git(['rev-parse', 'FETCH_HEAD'], { cwd })
  if (mergeBase !== fetchHead) {
    throw new Error('upstream/main (FETCH_HEAD) is not an ancestor of HEAD')
  }

  const localHead = git(['rev-parse', 'HEAD'], { cwd })
  const remoteHeadLine = git(['ls-remote', pushRemote, `refs/heads/${FORK_WORKING_BRANCH}`], {
    cwd
  })
  const remoteHead = remoteHeadLine.split(/\s+/)[0]
  if (localHead !== remoteHead) {
    throw new Error(
      `Local HEAD (${localHead}) does not match ${pushRemote}/${FORK_WORKING_BRANCH} (${remoteHead})`
    )
  }
}

export function executeNextDesktopTag({ cwd, write = false, auto = false } = {}) {
  const remotes = listGitRemotes(cwd)
  const pushRemote = resolvePushRemote(remotes)

  const trains = selectLatestTrains(loadUpstreamReleases())
  if (!trains.desktop?.tag) {
    throw new Error('No upstream desktop tag found')
  }

  const pushRemoteUrl = remotes.find((r) => r.name === pushRemote)?.url
  assertSafePushRemoteUrl(pushRemoteUrl)

  const forkTags = listRemoteTags(pushRemote, { cwd })
  const plan = auto
    ? buildAutoCutPlan({ upstreamTag: trains.desktop.tag, forkTags })
    : buildNextDesktopTagPlan({ upstreamTag: trains.desktop.tag, forkTags })

  if (plan.cut === false) {
    return { ...plan, pushRemote, wrote: false, skipped: true }
  }

  const localTags = listLocalTags({ cwd })
  if (localTags.includes(plan.nextTag) || forkTags.includes(plan.nextTag)) {
    throw new Error(`Tag ${plan.nextTag} already exists locally or on remote`)
  }

  if (!write && !auto) {
    return { ...plan, pushRemote, wrote: false }
  }

  assertSafeWorkingTreeForTag({ cwd, pushRemote })
  git(['tag', plan.nextTag], { cwd })
  git(['push', pushRemote, `refs/tags/${plan.nextTag}:refs/tags/${plan.nextTag}`], { cwd })

  return { ...plan, pushRemote, wrote: true }
}

function main() {
  const write = process.argv.includes('--write')
  const auto = process.argv.includes('--auto')
  const result = executeNextDesktopTag({ write, auto })
  process.stdout.write(result.skipped ? `skip: ${result.reason}\n` : `${result.nextTag}\n`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
