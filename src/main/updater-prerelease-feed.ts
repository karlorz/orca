import { net } from 'electron'
import { parse } from 'yaml'
import { compareVersions, isPrereleaseVersion, isValidVersion } from './updater-fallback'
import { isForkDesktopVersion } from '../shared/release-channel'

export type ReleaseFeedConfig = {
  repoAtomUrl: string
  releaseDownloadBase: string
  tagHrefPattern: RegExp
  desktopTagPattern: RegExp
}

export const STABLYAI_RELEASE_FEED: ReleaseFeedConfig = {
  repoAtomUrl: 'https://github.com/stablyai/orca/releases.atom',
  releaseDownloadBase: 'https://github.com/stablyai/orca/releases/download',
  tagHrefPattern: /href="https:\/\/github\.com\/stablyai\/orca\/releases\/tag\/([^"]+)"/,
  desktopTagPattern: /^v?\d+\.\d+\.\d+(?:-rc\.\d+(?:\.perf)?)?$/
}

export const KARLORZ_FORK_RELEASE_FEED: ReleaseFeedConfig = {
  repoAtomUrl: 'https://github.com/karlorz/orca/releases.atom',
  releaseDownloadBase: 'https://github.com/karlorz/orca/releases/download',
  tagHrefPattern: /href="https:\/\/github\.com\/karlorz\/orca\/releases\/tag\/([^"]+)"/,
  desktopTagPattern: /^v\d+\.\d+\.\d+-\d+$/
}

export function selectReleaseFeed(currentVersion: string): ReleaseFeedConfig {
  return isForkDesktopVersion(currentVersion) ? KARLORZ_FORK_RELEASE_FEED : STABLYAI_RELEASE_FEED
}

const FETCH_TIMEOUT_MS = 5000
const MAX_MANIFEST_PROBE_CANDIDATES = 6

export function getReleaseDownloadUrlForFeed(feed: ReleaseFeedConfig, tag: string): string {
  return `${feed.releaseDownloadBase}/${encodeURIComponent(tag)}`
}

export function getReleaseDownloadUrl(tag: string): string {
  return getReleaseDownloadUrlForFeed(STABLYAI_RELEASE_FEED, tag)
}

function getPlatformManifestName(): string {
  return process.platform === 'darwin'
    ? 'latest-mac.yml'
    : process.platform === 'linux'
      ? 'latest-linux.yml'
      : 'latest.yml'
}

function getReleaseManifestUrl(
  tag: string,
  feed: ReleaseFeedConfig = STABLYAI_RELEASE_FEED
): string {
  return `${getReleaseDownloadUrlForFeed(feed, tag)}/${getPlatformManifestName()}`
}

function getReleaseAssetUrl(
  tag: string,
  assetName: string,
  feed: ReleaseFeedConfig = STABLYAI_RELEASE_FEED
): string {
  return `${getReleaseDownloadUrlForFeed(feed, tag)}/${encodeURIComponent(assetName)}`
}

export function normalizeTagToVersion(tag: string): string {
  return tag.replace(/^v/i, '')
}

type ReleaseFeedTag = {
  tag: string
  version: string
}

export function isPerfPrereleaseTag(tag: string): boolean {
  const version = normalizeTagToVersion(tag)
  const match = version.match(/^\d+\.\d+\.\d+-([0-9A-Za-z-.]+)(?:\+[0-9A-Za-z-.]+)?$/)
  const id = match?.[1]?.split('.') ?? []
  return id.length === 3 && id[0] === 'rc' && /^\d+$/.test(id[1]) && id[2] === 'perf'
}

async function fetchReleaseFeedTags(
  feed: ReleaseFeedConfig = STABLYAI_RELEASE_FEED
): Promise<ReleaseFeedTag[] | null> {
  try {
    const res = await net.fetch(feed.repoAtomUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!res.ok) {
      return null
    }
    const body = await res.text()
    const tags: ReleaseFeedTag[] = []
    const pattern = new RegExp(
      feed.tagHrefPattern.source,
      feed.tagHrefPattern.flags.includes('g')
        ? feed.tagHrefPattern.flags
        : `${feed.tagHrefPattern.flags}g`
    )

    for (const match of body.matchAll(pattern)) {
      const tag = match[1]
      const version = normalizeTagToVersion(tag)
      if (isValidVersion(version)) {
        tags.push({ tag, version })
      }
    }

    tags.sort((left, right) => compareVersions(right.version, left.version))
    return tags
  } catch {
    return null
  }
}

type ManifestAssetEntry = {
  url?: unknown
  path?: unknown
}

function getManifestAssetNames(manifestText: string): string[] {
  const parsed = parse(manifestText) as {
    files?: ManifestAssetEntry[]
    path?: unknown
  } | null

  const names = new Set<string>()
  for (const file of Array.isArray(parsed?.files) ? parsed.files : []) {
    const value = typeof file.url === 'string' ? file.url : file.path
    if (typeof value === 'string' && value.trim()) {
      names.add(value.trim())
    }
  }
  if (typeof parsed?.path === 'string' && parsed.path.trim()) {
    names.add(parsed.path.trim())
  }
  return [...names]
}

function getManifestVersion(manifestText: string): string | null {
  try {
    const parsed = parse(manifestText) as { version?: unknown } | null
    if (typeof parsed?.version === 'string' && parsed.version.trim()) {
      return parsed.version.trim()
    }
    return null
  } catch {
    return null
  }
}

type ReleaseReadiness = 'ready' | 'not-ready' | 'unavailable'

type ManifestReadinessResult = {
  readiness: ReleaseReadiness
  manifestVersion?: string | null
}

async function isReleaseAssetAvailable(
  tag: string,
  assetName: string,
  feed: ReleaseFeedConfig = STABLYAI_RELEASE_FEED
): Promise<ReleaseReadiness> {
  try {
    const assetUrl = assetName.startsWith('http')
      ? assetName
      : getReleaseAssetUrl(tag, assetName.split('/').findLast(Boolean) ?? assetName, feed)
    const res = await net.fetch(assetUrl, {
      method: 'HEAD',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    })
    return res.status === 404 ? 'not-ready' : res.ok ? 'ready' : 'unavailable'
  } catch {
    return 'unavailable'
  }
}

async function getPlatformManifestReadiness(
  tag: string,
  feed: ReleaseFeedConfig = STABLYAI_RELEASE_FEED
): Promise<ManifestReadinessResult> {
  try {
    // Why: cancelled/draft releases can appear in GitHub's atom feed before
    // they have updater manifests or the ZIP/exe/AppImage assets referenced by
    // those manifests. Pinning to those tags makes download clicks 404.
    const manifestUrl = getReleaseManifestUrl(tag, feed)
    const res = await net.fetch(manifestUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (res.status === 404) {
      return { readiness: 'not-ready' }
    }
    if (!res.ok) {
      return { readiness: 'unavailable' }
    }
    const manifestText = await res.text()
    const manifestVersion = getManifestVersion(manifestText)
    let assetNames: string[]
    try {
      assetNames = getManifestAssetNames(manifestText)
    } catch {
      return { readiness: 'not-ready', manifestVersion }
    }
    if (assetNames.length === 0) {
      return { readiness: 'not-ready', manifestVersion }
    }
    const assetResults = await Promise.all(
      assetNames.map((assetName) => isReleaseAssetAvailable(tag, assetName, feed))
    )
    const readiness = assetResults.includes('not-ready')
      ? 'not-ready'
      : assetResults.includes('unavailable')
        ? 'unavailable'
        : 'ready'
    return { readiness, manifestVersion }
  } catch {
    return { readiness: 'unavailable' }
  }
}

export async function fetchNewerForkDesktopReleaseTag(
  currentVersion: string,
  feed: ReleaseFeedConfig = KARLORZ_FORK_RELEASE_FEED
): Promise<string | null> {
  const tags = await fetchReleaseFeedTags(feed)
  if (!tags) {
    return null
  }

  const forkDesktopCandidates = tags.filter(({ tag }) => feed.desktopTagPattern.test(tag))
  if (forkDesktopCandidates.length === 0) {
    return null
  }

  const probeCandidates = forkDesktopCandidates.slice(0, MAX_MANIFEST_PROBE_CANDIDATES)
  for (const { tag } of probeCandidates) {
    const probe = await getPlatformManifestReadiness(tag, feed)
    if (
      probe.readiness === 'ready' &&
      probe.manifestVersion &&
      isValidVersion(probe.manifestVersion)
    ) {
      if (compareVersions(probe.manifestVersion, currentVersion) > 0) {
        return tag
      }
    }
  }

  return null
}

/**
 * Walks the GitHub releases atom feed and returns the tag of the newest
 * release strictly greater than `currentVersion`.
 *
 * Why: electron-updater's GitHubProvider filters the feed by channel, and
 * GitHub's /latest/download redirect can move between check and download.
 * By resolving the newest tag ourselves and pinning the generic provider at
 * `/releases/download/<tag>`, the manifest and downloaded asset stay tied to
 * the same release.
 *
 * Returns null if the fetch fails, the feed has no parseable tags, or
 * nothing in the feed is newer than `currentVersion`.
 */
type FetchNewerReleaseTagOptions = {
  includePrerelease?: boolean
  releaseFilter?: 'perf'
}

export type FetchNewerReleaseTagsResult =
  | { tags: string[]; state: 'ready' }
  | { tags: string[]; state: 'no-newer' }
  | { tags: string[]; state: 'not-ready'; lastGoodTag?: string }
  | { tags: string[]; state: 'unavailable'; unavailableReason: 'feed' | 'manifest' }

export async function fetchNewerReleaseTag(
  currentVersion: string,
  options: FetchNewerReleaseTagOptions = {}
): Promise<string | null> {
  return (await fetchNewerReleaseTags(currentVersion, 1, options))[0] ?? null
}

export async function fetchNewerReleaseTags(
  currentVersion: string,
  maxTags: number,
  options: FetchNewerReleaseTagOptions = {}
): Promise<string[]> {
  return (await fetchNewerReleaseTagsWithReadiness(currentVersion, maxTags, options)).tags
}

export async function fetchNewerReleaseTagsWithReadiness(
  currentVersion: string,
  maxTags: number,
  options: FetchNewerReleaseTagOptions = {}
): Promise<FetchNewerReleaseTagsResult> {
  const includePrerelease = options.includePrerelease ?? true
  if (maxTags <= 0) {
    return { tags: [], state: 'no-newer' }
  }
  const tags = await fetchReleaseFeedTags()
  if (!tags) {
    return { tags: [], state: 'unavailable', unavailableReason: 'feed' }
  }

  // Why: perf builds are explicit opt-in; regular prerelease checks should
  // stay on the main RC/stable series even though perf tags are semver-newer.
  const candidates =
    options.releaseFilter === 'perf'
      ? tags.filter(({ tag }) => isPerfPrereleaseTag(tag))
      : includePrerelease
        ? tags.filter(({ tag }) => !isPerfPrereleaseTag(tag))
        : tags.filter(({ version }) => !isPrereleaseVersion(version))
  const newestNewerIndex = candidates.findIndex(
    ({ version }) => compareVersions(version, currentVersion) > 0
  )
  if (newestNewerIndex === -1) {
    return { tags: [], state: 'no-newer' }
  }

  // Why: a cancelled release can leave several feed entries without manifests,
  // but update checks must not stall on an unbounded run of 5s probes.
  const probeCandidates = candidates.slice(
    newestNewerIndex,
    newestNewerIndex + MAX_MANIFEST_PROBE_CANDIDATES
  )
  const manifestResults = await Promise.all(
    probeCandidates.map(async ({ tag, version }) => ({
      tag,
      version,
      readiness: (await getPlatformManifestReadiness(tag)).readiness
    }))
  )

  const primaryIndex = manifestResults.findIndex(
    ({ readiness, version }) =>
      readiness === 'ready' && compareVersions(version, currentVersion) > 0
  )
  if (primaryIndex === -1) {
    if (manifestResults[0]?.readiness === 'unavailable') {
      return { tags: [], state: 'unavailable', unavailableReason: 'manifest' }
    }
    const lastGoodTag = manifestResults.find(({ readiness }) => readiness === 'ready')?.tag
    return lastGoodTag
      ? { tags: [], state: 'not-ready', lastGoodTag }
      : { tags: [], state: 'not-ready' }
  }

  if (primaryIndex > 0) {
    if (manifestResults[0]?.readiness === 'unavailable') {
      return { tags: [], state: 'unavailable', unavailableReason: 'manifest' }
    }
    return { tags: [], state: 'not-ready', lastGoodTag: manifestResults[primaryIndex].tag }
  }

  return {
    tags: manifestResults
      .slice(primaryIndex)
      .filter(({ readiness }) => readiness === 'ready')
      .slice(0, maxTags)
      .map(({ tag }) => tag),
    state: 'ready'
  }
}
