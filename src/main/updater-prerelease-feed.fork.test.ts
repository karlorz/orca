import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  KARLORZ_FORK_RELEASE_FEED,
  STABLYAI_RELEASE_FEED,
  fetchNewerForkDesktopReleaseTag,
  getReleaseDownloadUrlForFeed,
  selectReleaseFeed
} from './updater-prerelease-feed'

const ORIGINAL_PLATFORM = process.platform

const { netFetchMock } = vi.hoisted(() => ({
  netFetchMock: vi.fn()
}))

vi.mock('electron', () => ({
  net: { fetch: netFetchMock }
}))

function buildAtomFeed(tags: string[], owner = 'karlorz'): string {
  const entries = tags
    .map(
      (tag) =>
        `<entry><link rel="alternate" type="text/html" href="https://github.com/${owner}/orca/releases/tag/${tag}"/><title>${tag}</title></entry>`
    )
    .join('')
  return `<?xml version="1.0" encoding="UTF-8"?><feed>${entries}</feed>`
}

function buildManifest(version: string): string {
  return [
    `version: ${version}`,
    'files:',
    `  - url: Orca-${version}-arm64-mac.zip`,
    '    sha512: test',
    `path: Orca-${version}-arm64-mac.zip`
  ].join('\n')
}

function respondWithForkAtom(
  tags: string[],
  manifestVersionsByTag: Record<string, string> = {},
  missingManifestTags: string[] = [],
  missingAssetTags: string[] = []
): void {
  const missingManifests = new Set(missingManifestTags)
  const missingAssets = new Set(missingAssetTags)

  netFetchMock.mockImplementation((url: string, init?: { method?: string }) => {
    if (url === 'https://github.com/karlorz/orca/releases.atom') {
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(buildAtomFeed(tags, 'karlorz'))
      })
    }

    const manifestMatch = url.match(
      /https:\/\/github\.com\/karlorz\/orca\/releases\/download\/([^/]+)\/latest(?:-[a-z]+)?\.yml$/
    )
    if (manifestMatch) {
      const tag = decodeURIComponent(manifestMatch[1])
      if (missingManifests.has(tag)) {
        return Promise.resolve({
          ok: false,
          status: 404,
          text: () => Promise.resolve('')
        })
      }
      const manifestVersion = manifestVersionsByTag[tag] ?? tag.replace(/^v/i, '')
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(buildManifest(manifestVersion))
      })
    }

    const assetMatch = url.match(
      /https:\/\/github\.com\/karlorz\/orca\/releases\/download\/([^/]+)\/(.+)$/
    )
    if (assetMatch && init?.method === 'HEAD') {
      const tag = decodeURIComponent(assetMatch[1])
      return Promise.resolve({
        ok: !missingAssets.has(tag),
        status: missingAssets.has(tag) ? 404 : 200,
        text: () => Promise.resolve('')
      })
    }

    return Promise.resolve({
      ok: false,
      text: () => Promise.resolve('')
    })
  })
}

function setPlatformForTest(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform })
}

describe('selectReleaseFeed', () => {
  it('selects karlorz feed for fork.voice versions', () => {
    expect(selectReleaseFeed('1.4.190-fork.voice.1.1.abcdef1')).toEqual(KARLORZ_FORK_RELEASE_FEED)
  })

  it('selects stablyai feed for upstream versions', () => {
    expect(selectReleaseFeed('1.4.190')).toEqual(STABLYAI_RELEASE_FEED)
    expect(selectReleaseFeed('1.4.190-rc.1')).toEqual(STABLYAI_RELEASE_FEED)
  })

  it('builds feed-aware release download URLs', () => {
    expect(getReleaseDownloadUrlForFeed(KARLORZ_FORK_RELEASE_FEED, 'v1.4.190-0')).toBe(
      'https://github.com/karlorz/orca/releases/download/v1.4.190-0'
    )
    expect(getReleaseDownloadUrlForFeed(STABLYAI_RELEASE_FEED, 'v1.4.190')).toBe(
      'https://github.com/stablyai/orca/releases/download/v1.4.190'
    )
  })
})

describe('fetchNewerForkDesktopReleaseTag', () => {
  beforeEach(() => {
    vi.resetModules()
    netFetchMock.mockReset()
  })

  afterEach(() => {
    setPlatformForTest(ORIGINAL_PLATFORM)
  })

  it('filters out mobile tags, legacy desktop-v* tags, and bare upstream tags', async () => {
    respondWithForkAtom(
      ['mobile-android-v0.0.44-0', 'desktop-v1.4.178-0', 'v1.4.190', 'v1.4.190-1', 'v1.4.190-0'],
      {
        'v1.4.190-1': '1.4.190-fork.voice.2.1.abcdef2',
        'v1.4.190-0': '1.4.190-fork.voice.1.1.abcdef1'
      }
    )

    const tag = await fetchNewerForkDesktopReleaseTag('1.4.190-fork.voice.1.1.abcdef1')
    expect(tag).toBe('v1.4.190-1')
    expect(netFetchMock).toHaveBeenCalledWith(
      'https://github.com/karlorz/orca/releases.atom',
      expect.anything()
    )
  })

  it('returns newer fork tag based on manifest version comparison instead of tag name', async () => {
    respondWithForkAtom(['v1.4.190-1', 'v1.4.190-0'], {
      'v1.4.190-1': '1.4.190-fork.voice.2.1.abcdef2',
      'v1.4.190-0': '1.4.190-fork.voice.1.1.abcdef1'
    })

    // Current version is run 1; run 2 in manifest is newer
    const tag = await fetchNewerForkDesktopReleaseTag('1.4.190-fork.voice.1.1.abcdef1')
    expect(tag).toBe('v1.4.190-1')
  })

  it('returns null when candidate manifest version is older or equal', async () => {
    respondWithForkAtom(['v1.4.190-1', 'v1.4.190-0'], {
      'v1.4.190-1': '1.4.190-fork.voice.2.1.abcdef2',
      'v1.4.190-0': '1.4.190-fork.voice.1.1.abcdef1'
    })

    const tag = await fetchNewerForkDesktopReleaseTag('1.4.190-fork.voice.2.1.abcdef2')
    expect(tag).toBeNull()
  })

  it('skips candidates with missing manifests or incomplete assets and picks the first valid newer one', async () => {
    respondWithForkAtom(
      ['v1.4.190-2', 'v1.4.190-1', 'v1.4.190-0'],
      {
        'v1.4.190-2': '1.4.190-fork.voice.3.1.abcdef3',
        'v1.4.190-1': '1.4.190-fork.voice.2.1.abcdef2',
        'v1.4.190-0': '1.4.190-fork.voice.1.1.abcdef1'
      },
      ['v1.4.190-2'] // v1.4.190-2 missing manifest
    )

    const tag = await fetchNewerForkDesktopReleaseTag('1.4.190-fork.voice.1.1.abcdef1')
    expect(tag).toBe('v1.4.190-1')
  })

  it('returns null when atom feed fetch fails or has no newer releases', async () => {
    netFetchMock.mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve('') })
    const tag = await fetchNewerForkDesktopReleaseTag('1.4.190-fork.voice.1.1.abcdef1')
    expect(tag).toBeNull()
  })
})
