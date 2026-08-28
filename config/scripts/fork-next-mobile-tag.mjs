import { compareSemverBases } from './fork-next-desktop-tag.mjs'
import { selectLatestTrains, loadUpstreamReleases } from './fork-upstream-trains.mjs'
import { listGitRemotes, resolvePushRemote } from './fork-sync-fork-main.mjs'
import { spawnSync } from 'node:child_process'

const UPSTREAM_MOBILE_TAG = /^mobile-android-v(\d+\.\d+\.\d+)$/
const FORK_MOBILE_TAG = /^mobile-android-v(\d+\.\d+\.\d+)-(\d+)$/

export function parseUpstreamMobileBase(tag) {
  const match = UPSTREAM_MOBILE_TAG.exec(String(tag ?? '').trim())
  if (!match) {
    throw new Error(`Tag is not a valid upstream mobile release tag: ${tag}`)
  }
  return match[1]
}

export function nextForkSuffix(existingForkTagNames, base) {
  const cleanBase = parseUpstreamMobileBase(`mobile-android-v${base.replace(/^v/, '')}`)
  let maxSuffix = -1
  for (const rawTag of existingForkTagNames ?? []) {
    const tagName = String(rawTag ?? '').replace(/^refs\/tags\//, '')
    const match = FORK_MOBILE_TAG.exec(tagName)
    if (match && match[1] === cleanBase) {
      const suffix = Number(match[2])
      if (suffix > maxSuffix) {
        maxSuffix = suffix
      }
    }
  }
  return maxSuffix + 1
}

export function buildNextMobileTagPlan({ upstreamTag, forkTags }) {
  const base = parseUpstreamMobileBase(upstreamTag)
  const tagList = Array.isArray(forkTags) ? forkTags : []

  for (const rawTag of tagList) {
    const tagName = String(rawTag ?? '').replace(/^refs\/tags\//, '')
    const match = FORK_MOBILE_TAG.exec(tagName)
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
  const nextTag = `mobile-android-v${base}-${suffix}`
  return {
    upstreamTag,
    base,
    suffix,
    nextTag,
    tagRef: `refs/tags/${nextTag}`
  }
}

export function buildAutoCutPlan({ upstreamTag, forkTags }) {
  const base = parseUpstreamMobileBase(upstreamTag)
  const tagList = Array.isArray(forkTags) ? forkTags : []

  let highest = null
  for (const rawTag of tagList) {
    const tagName = String(rawTag ?? '').replace(/^refs\/tags\//, '')
    const match = FORK_MOBILE_TAG.exec(tagName)
    if (match && (highest === null || compareSemverBases(match[1], highest) > 0)) {
      highest = match[1]
    }
  }

  if (highest !== null && compareSemverBases(base, highest) <= 0) {
    return {
      cut: false,
      reason: `base ${base} already covered by fork mobile tag base ${highest}`,
      upstreamTag,
      base
    }
  }

  const nextTag = `mobile-android-v${base}-0`
  return { cut: true, upstreamTag, base, suffix: 0, nextTag, tagRef: `refs/tags/${nextTag}` }
}

function git(args, { cwd } = {}) {
  const result = spawnSync('git', args, {
    encoding: 'utf8',
    cwd,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim()
    throw new Error(`git ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`)
  }
  return (result.stdout ?? '').trim()
}

function listRemoteTags(remote, { cwd } = {}) {
  const stdout = git(['ls-remote', '--tags', remote], { cwd })
  const tags = []
  for (const line of stdout.split('\n')) {
    const match = /^\S+\s+(refs\/tags\/\S+)$/.exec(line.trim())
    if (match && !match[1].endsWith('^{}')) {
      tags.push(match[1].replace(/^refs\/tags\//, ''))
    }
  }
  return tags
}

export function reportNextMobileTag({ cwd } = {}) {
  const trains = selectLatestTrains(loadUpstreamReleases())
  if (!trains.mobile?.tag) {
    throw new Error('No upstream mobile tag found')
  }
  const remotes = listGitRemotes(cwd)
  const pushRemote = resolvePushRemote(remotes)
  const forkTags = listRemoteTags(pushRemote, { cwd })
  const next = buildNextMobileTagPlan({
    upstreamTag: trains.mobile.tag,
    forkTags
  })
  const auto = buildAutoCutPlan({
    upstreamTag: trains.mobile.tag,
    forkTags
  })
  return {
    train: trains.mobile,
    next,
    auto,
    pushRemote
  }
}

function main() {
  const result = reportNextMobileTag()
  const autoLine = result.auto.cut
    ? `auto-cut candidate: ${result.auto.nextTag} (not applied; mobile is attended)`
    : `auto-cut: skip (${result.auto.reason})`
  process.stdout.write(
    [
      `mobile train: ${result.train.tag} (${result.train.prerelease ? 'prerelease' : 'stable'})`,
      `next attended fork tag: ${result.next.nextTag}`,
      autoLine,
      ''
    ].join('\n')
  )
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
