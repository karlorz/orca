import { net } from 'electron'
import { parse } from 'yaml'
import { STABLYAI_RELEASE_FEED, type ReleaseFeedConfig } from './updater-release-feeds'

const FETCH_TIMEOUT_MS = 5000

export type ReleaseReadiness = 'ready' | 'not-ready' | 'unavailable'

export type ManifestReadinessResult = {
  readiness: ReleaseReadiness
  manifestVersion?: string | null
}

export function getReleaseDownloadUrlForFeed(feed: ReleaseFeedConfig, tag: string): string {
  return `${feed.releaseDownloadBase}/${encodeURIComponent(tag)}`
}

export function getReleaseDownloadUrl(tag: string): string {
  return getReleaseDownloadUrlForFeed(STABLYAI_RELEASE_FEED, tag)
}

function getPlatformManifestName(): string {
  if (process.platform === 'darwin') {
    return 'latest-mac.yml'
  }
  if (process.platform === 'linux') {
    return 'latest-linux.yml'
  }
  return 'latest.yml'
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

function getGitHubReleaseAssetReadiness(assetUrl: string): Promise<ReleaseReadiness> {
  return new Promise((resolve) => {
    const request = net.request({ method: 'HEAD', url: assetUrl, redirect: 'manual' })
    let settled = false
    const settle = (readiness: ReleaseReadiness): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      resolve(readiness)
    }
    const timeout = setTimeout(() => {
      try {
        request.abort()
      } catch {
        // The request may already have been cancelled by Electron.
      }
      settle('unavailable')
    }, FETCH_TIMEOUT_MS)

    request.on('redirect', (statusCode) => {
      // Why: GitHub's 302 proves the asset exists without probing its signed storage URL.
      settle(statusCode >= 300 && statusCode < 400 ? 'ready' : 'unavailable')
    })
    request.on('response', (response) => {
      settle(
        response.statusCode === 404
          ? 'not-ready'
          : response.statusCode >= 200 && response.statusCode < 300
            ? 'ready'
            : 'unavailable'
      )
    })
    request.on('error', () => settle('unavailable'))
    try {
      request.end()
    } catch {
      settle('unavailable')
    }
  })
}

async function getReleaseAssetReadiness(
  tag: string,
  assetName: string,
  feed: ReleaseFeedConfig = STABLYAI_RELEASE_FEED
): Promise<ReleaseReadiness> {
  const isRelativeAsset = !/^https?:\/\//i.test(assetName)
  const isGitHubReleaseAsset =
    process.platform === 'win32' &&
    (isRelativeAsset ||
      /^https:\/\/github\.com\/(?:stablyai|karlorz)\/orca\/releases\/download\//i.test(assetName))
  const assetUrl = isRelativeAsset
    ? getReleaseAssetUrl(tag, assetName.split('/').findLast(Boolean) ?? assetName, feed)
    : assetName
  if (isGitHubReleaseAsset) {
    return getGitHubReleaseAssetReadiness(assetUrl)
  }

  try {
    const res = await net.fetch(assetUrl, {
      method: 'HEAD',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    })
    if (res.status === 404) {
      return 'not-ready'
    }
    return res.ok ? 'ready' : 'unavailable'
  } catch {
    return 'unavailable'
  }
}

export async function getPlatformManifestReadiness(
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
      assetNames.map((assetName) => getReleaseAssetReadiness(tag, assetName, feed))
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
