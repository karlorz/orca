import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { assertSafeWorkingTreeForTag, compareSemverBases } from './fork-next-desktop-tag.mjs'
import { selectLatestTrains, loadUpstreamReleases } from './fork-upstream-trains.mjs'
import {
  FORK_WORKING_BRANCH,
  listGitRemotes,
  resolvePushRemote,
  assertSafePushRemoteUrl
} from './fork-git-remote.mjs'

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

export function planMobileAppJsonForTrain({
  expoVersion: _expoVersion,
  versionCode,
  trainBase,
  bumpVersionCode = false
}) {
  parseUpstreamMobileBase(`mobile-android-v${trainBase}`)
  const code = Number(versionCode)
  if (!Number.isSafeInteger(code) || code <= 0) {
    throw new Error(`Invalid Android versionCode: ${versionCode}`)
  }
  return {
    expoVersion: trainBase,
    versionCode: bumpVersionCode ? code + 1 : code
  }
}

export function resolveForkMobileAppJson({ ours, theirs, trainBase }) {
  if (!ours?.expo?.android || !theirs?.expo?.android) {
    throw new Error('mobile/app.json sides are missing expo.android')
  }
  parseUpstreamMobileBase(`mobile-android-v${trainBase}`)
  const resolved = structuredClone(ours)
  resolved.expo.version = trainBase
  const ourCode = Number(ours.expo.android.versionCode)
  const theirCode = Number(theirs.expo.android.versionCode)
  const maxCode = Math.max(
    Number.isSafeInteger(ourCode) ? ourCode : 0,
    Number.isSafeInteger(theirCode) ? theirCode : 0
  )
  if (maxCode <= 0) {
    throw new Error('mobile/app.json versionCode is missing on both sides')
  }
  resolved.expo.android.versionCode = maxCode
  resolved.expo.android.permissions = [
    ...new Set([
      ...(ours.expo.android.permissions ?? []),
      ...(theirs.expo.android.permissions ?? [])
    ])
  ]
  return resolved
}

function mobileAppJsonPath(cwd) {
  return join(cwd ?? process.cwd(), 'mobile/app.json')
}

function applyMobileAppJsonTrainBump({ cwd, trainBase }) {
  const path = mobileAppJsonPath(cwd)
  const json = JSON.parse(readFileSync(path, 'utf8'))
  const next = planMobileAppJsonForTrain({
    expoVersion: json.expo.version,
    versionCode: json.expo.android.versionCode,
    trainBase,
    bumpVersionCode: true
  })
  json.expo.version = next.expoVersion
  json.expo.android.versionCode = next.versionCode
  writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`)
  return next
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

function listLocalTags({ cwd } = {}) {
  const stdout = git(['tag', '-l'], { cwd })
  return stdout
    ? stdout
        .split('\n')
        .map((tag) => tag.trim())
        .filter(Boolean)
    : []
}

export function executeNextMobileTag({ cwd, write = false, auto = false } = {}) {
  const remotes = listGitRemotes(cwd)
  const pushRemote = resolvePushRemote(remotes)
  const trains = selectLatestTrains(loadUpstreamReleases())
  if (!trains.mobile?.tag) {
    throw new Error('No upstream mobile tag found')
  }

  const pushRemoteUrl = remotes.find((r) => r.name === pushRemote)?.url
  assertSafePushRemoteUrl(pushRemoteUrl)

  const forkTags = listRemoteTags(pushRemote, { cwd })
  const plan = auto
    ? buildAutoCutPlan({ upstreamTag: trains.mobile.tag, forkTags })
    : buildNextMobileTagPlan({ upstreamTag: trains.mobile.tag, forkTags })

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
  const bump = applyMobileAppJsonTrainBump({ cwd, trainBase: plan.base })
  git(['add', 'mobile/app.json'], { cwd })
  git(
    [
      'commit',
      '-m',
      `chore(mobile): set expo.version ${bump.expoVersion} versionCode ${bump.versionCode} for ${plan.nextTag}`
    ],
    { cwd }
  )
  git(['push', pushRemote, `HEAD:${FORK_WORKING_BRANCH}`], { cwd })
  git(['tag', plan.nextTag], { cwd })
  git(['push', pushRemote, `refs/tags/${plan.nextTag}:refs/tags/${plan.nextTag}`], { cwd })
  return { ...plan, pushRemote, wrote: true, bump }
}

function main() {
  const write = process.argv.includes('--write')
  const auto = process.argv.includes('--auto')
  if (!write && !auto) {
    const result = reportNextMobileTag()
    const autoLine = result.auto.cut
      ? `auto-cut candidate: ${result.auto.nextTag}`
      : `auto-cut: skip (${result.auto.reason})`
    process.stdout.write(
      [
        `mobile train: ${result.train.tag} (${result.train.prerelease ? 'prerelease' : 'stable'})`,
        `next attended fork tag: ${result.next.nextTag}`,
        autoLine,
        ''
      ].join('\n')
    )
    return
  }
  const result = executeNextMobileTag({ write, auto })
  process.stdout.write(result.skipped ? `skip: ${result.reason}\n` : `${result.nextTag}\n`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
