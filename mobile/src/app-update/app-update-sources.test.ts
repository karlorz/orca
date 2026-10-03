import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createAppStoreUpdateSource, parseAppStoreLookup } from './app-store-update-source'
import { isNewerReleaseVersion } from './app-update-source'
import {
  createGithubReleaseUpdateSource,
  installableReleaseUrl,
  isNewerMobileAndroidRelease,
  MOBILE_ANDROID_RELEASE_REPO_API,
  mobileAndroidTrainVersion,
  parseMobileAndroidTagVersions
} from './github-release-update-source'

// Recorded once from the live endpoints on 2026-09-28, unedited.
function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))
}
const tagRefs = fixture('github-mobile-android-tag-refs.json')
const release050 = fixture('github-release-mobile-android-v0.0.50.json')
const lookup = fixture('itunes-lookup-com.stably.orca.mobile.json')

const REFS_URL = `${MOBILE_ANDROID_RELEASE_REPO_API}/git/matching-refs/tags/mobile-android-v`
const releaseUrl = (version: string) =>
  `${MOBILE_ANDROID_RELEASE_REPO_API}/releases/tags/mobile-android-v${version}`

function fakeFetch(routes: Record<string, { status: number; body?: unknown }>) {
  const requested: string[] = []
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input)
    requested.push(url)
    const route = routes[url]
    if (!route) {
      throw new Error(`unexpected request ${url}`)
    }
    return new Response(JSON.stringify(route.body ?? {}), { status: route.status })
  }
  return { fetchImpl, requested }
}

const signal = new AbortController().signal

describe('version compare', () => {
  it('orders plain versions numerically and ignores prerelease or malformed candidates', () => {
    expect(isNewerReleaseVersion('0.0.51', '0.0.48')).toBe(true)
    expect(isNewerReleaseVersion('0.0.10', '0.0.9')).toBe(true)
    expect(isNewerReleaseVersion('0.0.48', '0.0.48')).toBe(false)
    expect(isNewerReleaseVersion('0.0.47', '0.0.48')).toBe(false)
    expect(isNewerReleaseVersion('0.0.52-rc.1', '0.0.48')).toBe(false)
    expect(isNewerReleaseVersion('latest', '0.0.48')).toBe(false)
  })

  it('reads a fork suffix tag as its train and treats that train as the installable version', () => {
    expect(mobileAndroidTrainVersion('0.0.52-0')).toBe('0.0.52')
    expect(mobileAndroidTrainVersion('0.0.52')).toBe('0.0.52')
    expect(mobileAndroidTrainVersion('0.0.52-rc.1')).toBeNull()
    expect(isNewerMobileAndroidRelease('0.0.52-0', '0.0.50')).toBe(true)
    expect(isNewerMobileAndroidRelease('0.0.52-0', '0.0.52')).toBe(false)
    expect(isNewerMobileAndroidRelease('0.0.52-1', '0.0.52')).toBe(false)
    expect(isNewerMobileAndroidRelease('0.0.52-rc.1', '0.0.50')).toBe(false)
  })
})

describe('GitHub release source (Android sideload)', () => {
  it('reads every mobile-android tag from the recorded refs', () => {
    const versions = parseMobileAndroidTagVersions(tagRefs)
    expect(versions).toHaveLength(24)
    expect(versions).toContain('0.0.50')
    expect(versions).not.toContain('0.0.49')
  })

  it('accepts the recorded release only because it is published with an APK', () => {
    expect(installableReleaseUrl(release050)).toBe(
      'https://github.com/stablyai/orca/releases/tag/mobile-android-v0.0.50'
    )
    expect(installableReleaseUrl({ ...Object(release050), draft: true })).toBeNull()
    expect(installableReleaseUrl({ ...Object(release050), assets: [] })).toBeNull()
  })

  it('offers the newest tag above the installed version once its release is proven', async () => {
    const { fetchImpl, requested } = fakeFetch({
      [REFS_URL]: { status: 200, body: tagRefs },
      [releaseUrl('0.0.50')]: { status: 200, body: release050 }
    })
    await expect(
      createGithubReleaseUpdateSource(fetchImpl).check('0.0.47', signal)
    ).resolves.toEqual({
      kind: 'available',
      version: '0.0.50',
      url: 'https://github.com/stablyai/orca/releases/tag/mobile-android-v0.0.50'
    })
    expect(requested).toEqual([REFS_URL, releaseUrl('0.0.50')])
  })

  it('probes a fork suffix tag and offers its train, not the suffix string', async () => {
    const forkRefs = [{ ref: 'refs/tags/mobile-android-v0.0.52-0' }]
    const forkRelease = {
      ...Object(release050),
      html_url: 'https://github.com/karlorz/orca/releases/tag/mobile-android-v0.0.52-0'
    }
    const { fetchImpl, requested } = fakeFetch({
      [REFS_URL]: { status: 200, body: forkRefs },
      [releaseUrl('0.0.52-0')]: { status: 200, body: forkRelease }
    })
    await expect(
      createGithubReleaseUpdateSource(fetchImpl).check('0.0.50', signal)
    ).resolves.toEqual({
      kind: 'available',
      version: '0.0.52',
      url: 'https://github.com/karlorz/orca/releases/tag/mobile-android-v0.0.52-0'
    })
    expect(requested).toEqual([REFS_URL, releaseUrl('0.0.52-0')])
  })

  it('stays current when the newest fork tag is the installed train', async () => {
    const { fetchImpl, requested } = fakeFetch({
      [REFS_URL]: { status: 200, body: [{ ref: 'refs/tags/mobile-android-v0.0.52-0' }] }
    })
    await expect(
      createGithubReleaseUpdateSource(fetchImpl).check('0.0.52', signal)
    ).resolves.toEqual({ kind: 'current' })
    expect(requested).toEqual([REFS_URL])
  })

  it('falls back past a tag whose build never published a release', async () => {
    const release048 = { ...Object(release050), html_url: 'https://example.test/048' }
    const { fetchImpl } = fakeFetch({
      [REFS_URL]: { status: 200, body: tagRefs },
      [releaseUrl('0.0.50')]: { status: 404 },
      [releaseUrl('0.0.48')]: { status: 200, body: release048 }
    })
    await expect(
      createGithubReleaseUpdateSource(fetchImpl).check('0.0.47', signal)
    ).resolves.toEqual({
      kind: 'available',
      version: '0.0.48',
      url: 'https://example.test/048'
    })
  })

  it('probes at most three candidates and then reports current', async () => {
    const { fetchImpl, requested } = fakeFetch({
      [REFS_URL]: { status: 200, body: tagRefs },
      [releaseUrl('0.0.50')]: { status: 404 },
      [releaseUrl('0.0.48')]: { status: 404 },
      [releaseUrl('0.0.47')]: { status: 404 }
    })
    await expect(
      createGithubReleaseUpdateSource(fetchImpl).check('0.0.14', signal)
    ).resolves.toEqual({
      kind: 'current'
    })
    expect(requested).toHaveLength(4)
  })

  it('makes no release probe when nothing is newer', async () => {
    const { fetchImpl, requested } = fakeFetch({ [REFS_URL]: { status: 200, body: tagRefs } })
    await expect(
      createGithubReleaseUpdateSource(fetchImpl).check('0.0.51', signal)
    ).resolves.toEqual({
      kind: 'current'
    })
    expect(requested).toEqual([REFS_URL])
  })

  it('opens the release page GitHub reports, not one built from the tag', async () => {
    const renamed = {
      ...Object(release050),
      html_url: 'https://github.com/stablyai/orca/releases/tag/renamed-page'
    }
    const { fetchImpl } = fakeFetch({
      [REFS_URL]: { status: 200, body: tagRefs },
      [releaseUrl('0.0.50')]: { status: 200, body: renamed }
    })
    await expect(
      createGithubReleaseUpdateSource(fetchImpl).check('0.0.48', signal)
    ).resolves.toEqual({
      kind: 'available',
      version: '0.0.50',
      url: 'https://github.com/stablyai/orca/releases/tag/renamed-page'
    })
  })

  it('rejects on a release probe 5xx instead of moving to an older candidate', async () => {
    const { fetchImpl, requested } = fakeFetch({
      [REFS_URL]: { status: 200, body: tagRefs },
      [releaseUrl('0.0.50')]: { status: 502 }
    })
    await expect(
      createGithubReleaseUpdateSource(fetchImpl).check('0.0.47', signal)
    ).rejects.toThrow('release HTTP 502')
    expect(requested).toEqual([REFS_URL, releaseUrl('0.0.50')])
  })

  it('rejects when a release probe cannot reach GitHub', async () => {
    const { fetchImpl } = fakeFetch({ [REFS_URL]: { status: 200, body: tagRefs } })
    await expect(
      createGithubReleaseUpdateSource(fetchImpl).check('0.0.47', signal)
    ).rejects.toThrow('unexpected request')
  })

  it('rejects when GitHub refuses, so the check counts as failed rather than current', async () => {
    const { fetchImpl } = fakeFetch({ [REFS_URL]: { status: 403 } })
    await expect(
      createGithubReleaseUpdateSource(fetchImpl).check('0.0.47', signal)
    ).rejects.toThrow('tag refs HTTP 403')
  })
})

describe('App Store source (iOS)', () => {
  const LOOKUP = 'https://itunes.apple.com/lookup?bundleId=com.stably.orca.mobile'

  it('reads the store version and App Store page from the recorded lookup', () => {
    expect(parseAppStoreLookup(lookup)).toEqual({
      version: '0.0.51',
      url: 'https://apps.apple.com/us/app/orca-ide/id6766130217?uo=4'
    })
  })

  it('offers the store version only when it is newer than the installed one', async () => {
    const { fetchImpl } = fakeFetch({ [LOOKUP]: { status: 200, body: lookup } })
    const source = createAppStoreUpdateSource(fetchImpl)
    await expect(source.check('0.0.48', signal)).resolves.toEqual({
      kind: 'available',
      version: '0.0.51',
      url: 'https://apps.apple.com/us/app/orca-ide/id6766130217?uo=4'
    })
    await expect(source.check('0.0.51', signal)).resolves.toEqual({ kind: 'current' })
  })

  it('stays quiet when the lookup has no listing for this bundle id', async () => {
    const { fetchImpl } = fakeFetch({
      [LOOKUP]: { status: 200, body: { resultCount: 0, results: [] } }
    })
    await expect(createAppStoreUpdateSource(fetchImpl).check('0.0.1', signal)).resolves.toEqual({
      kind: 'current'
    })
  })
})
