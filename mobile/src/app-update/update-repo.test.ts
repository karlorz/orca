import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGithubReleaseUpdateSource } from './github-release-update-source'
import {
  buildTimeMobileUpdateRepo,
  DEFAULT_MOBILE_UPDATE_REPO,
  isAllowedMobileUpdateRepo,
  MOBILE_UPDATE_REPO_ALLOW_LIST,
  MOBILE_UPDATE_STAGING_REPO,
  parseMobileUpdateRepo,
  resolveMobileUpdateRepo
} from './update-repo'

// JS-layer verification of the update-source override (fetch is mocked; nothing hits the network).
// TODO(ci): the instrumented Android test (MockWebServer serving fake tag refs + release JSON to a
// real APK) needs an Android SDK/emulator, which the dev box does not have; it is a CI follow-up.

function setBuildRepo(value: string | undefined): void {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, 'EXPO_PUBLIC_MOBILE_UPDATE_REPO')
    return
  }
  process.env.EXPO_PUBLIC_MOBILE_UPDATE_REPO = value
}

afterEach(() => setBuildRepo(undefined))

/** A fetch that answers "no mobile tags" and records every URL it was asked for. */
function recordingFetch() {
  const fetchImpl = vi.fn<typeof fetch>(async () => new Response('[]', { status: 200 }))
  const urls = () => fetchImpl.mock.calls.map(([input]) => String(input))
  return { fetchImpl, urls }
}

const signal = new AbortController().signal

describe('update repo allow-list', () => {
  it('holds only karlorz/orca while the staging slot is empty', () => {
    expect(MOBILE_UPDATE_STAGING_REPO).toBe('')
    expect(MOBILE_UPDATE_REPO_ALLOW_LIST).toEqual(['karlorz/orca'])
    expect(DEFAULT_MOBILE_UPDATE_REPO).toBe('karlorz/orca')
  })

  it.each([
    ['karlorz/orca', 'karlorz/orca'],
    ['  karlorz/orca  ', 'karlorz/orca'],
    ['some-owner/repo.name_1', 'some-owner/repo.name_1']
  ])('parses the slug %p', (raw, expected) => {
    expect(parseMobileUpdateRepo(raw)).toBe(expected)
  })

  it.each([
    [''],
    ['karlorz'],
    ['karlorz/orca/extra'],
    ['https://github.com/karlorz/orca'],
    ['evil.example.com/orca'],
    ['-owner/repo'],
    ['owner-/repo'],
    ['owner/..'],
    ['owner/re po']
  ])('rejects %p as a repo slug', (raw) => {
    expect(parseMobileUpdateRepo(raw)).toBeNull()
  })

  it('accepts only listed repos', () => {
    expect(isAllowedMobileUpdateRepo('karlorz/orca')).toBe(true)
    expect(isAllowedMobileUpdateRepo('stablyai/orca')).toBe(false)
    expect(isAllowedMobileUpdateRepo('stablyai/orca', ['karlorz/orca', 'stablyai/orca'])).toBe(true)
  })
})

describe('build-time repo (EXPO_PUBLIC_MOBILE_UPDATE_REPO)', () => {
  it('is the fork default when unset', () => {
    expect(buildTimeMobileUpdateRepo()).toBe('karlorz/orca')
  })

  it.each([['stablyai/orca'], ['not a slug'], ['']])(
    'falls back to the default for %p, which is not on the allow-list',
    (value) => {
      setBuildRepo(value)
      expect(buildTimeMobileUpdateRepo()).toBe('karlorz/orca')
    }
  )
})

describe('resolveMobileUpdateRepo', () => {
  const extendedList = ['karlorz/orca', 'karlorz/orca-staging-test']

  it('uses an allow-listed override in a development build', async () => {
    await expect(
      resolveMobileUpdateRepo({
        allowOverride: true,
        loadOverride: async () => 'karlorz/orca-staging-test',
        buildTimeRepo: () => 'karlorz/orca',
        allowList: extendedList
      })
    ).resolves.toBe('karlorz/orca-staging-test')
  })

  it('ignores a stored override in a release build without reading it', async () => {
    const loadOverride = vi.fn(async () => 'karlorz/orca-staging-test')
    await expect(
      resolveMobileUpdateRepo({
        allowOverride: false,
        loadOverride,
        buildTimeRepo: () => 'karlorz/orca',
        allowList: extendedList
      })
    ).resolves.toBe('karlorz/orca')
    expect(loadOverride).not.toHaveBeenCalled()
  })

  it.each([
    ['off the allow-list', async () => 'attacker/orca'],
    ['malformed', async () => 'https://evil.example.com/x'],
    ['absent', async () => null],
    [
      'unreadable',
      async () => {
        throw new Error('storage down')
      }
    ]
  ])('falls back to the build repo when the override is %s', async (_label, loadOverride) => {
    await expect(
      resolveMobileUpdateRepo({
        allowOverride: true,
        loadOverride,
        buildTimeRepo: () => 'karlorz/orca'
      })
    ).resolves.toBe('karlorz/orca')
  })
})

describe('GitHub release source with a repo resolver (fetch mocked)', () => {
  it('defaults to karlorz/orca on api.github.com', async () => {
    const { fetchImpl, urls } = recordingFetch()
    await expect(
      createGithubReleaseUpdateSource(fetchImpl).check('0.0.57', signal)
    ).resolves.toEqual({ kind: 'current' })
    expect(urls()).toEqual([
      'https://api.github.com/repos/karlorz/orca/git/matching-refs/tags/mobile-android-v'
    ])
  })

  it('reads the resolved override repo, re-resolving on every check', async () => {
    const { fetchImpl, urls } = recordingFetch()
    let stored: string | null = 'karlorz/orca-staging-test'
    const source = createGithubReleaseUpdateSource(fetchImpl, () =>
      resolveMobileUpdateRepo({
        allowOverride: true,
        loadOverride: async () => stored,
        buildTimeRepo: () => 'karlorz/orca',
        allowList: extendedListForSource
      })
    )
    await source.check('0.0.57', signal)
    stored = null
    await source.check('0.0.57', signal)
    expect(urls()).toEqual([
      'https://api.github.com/repos/karlorz/orca-staging-test/git/matching-refs/tags/mobile-android-v',
      'https://api.github.com/repos/karlorz/orca/git/matching-refs/tags/mobile-android-v'
    ])
  })

  it('never leaves api.github.com/repos/karlorz/orca for an off-list override', async () => {
    const { fetchImpl, urls } = recordingFetch()
    const source = createGithubReleaseUpdateSource(fetchImpl, () =>
      resolveMobileUpdateRepo({
        allowOverride: true,
        loadOverride: async () => 'attacker/orca',
        buildTimeRepo: buildTimeMobileUpdateRepo
      })
    )
    await source.check('0.0.57', signal)
    expect(
      urls().every((url) => url.startsWith('https://api.github.com/repos/karlorz/orca/'))
    ).toBe(true)
  })

  it('probes release tags on the overridden repo too', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.endsWith('/git/matching-refs/tags/mobile-android-v')) {
        return new Response(JSON.stringify([{ ref: 'refs/tags/mobile-android-v0.0.58-0' }]))
      }
      return new Response(
        JSON.stringify({
          draft: false,
          html_url:
            'https://github.com/karlorz/orca-staging-test/releases/tag/mobile-android-v0.0.58-0',
          assets: [{ name: 'orca-mobile.apk' }]
        })
      )
    })
    const source = createGithubReleaseUpdateSource(fetchImpl, () => 'karlorz/orca-staging-test')
    await expect(source.check('0.0.57', signal)).resolves.toEqual({
      kind: 'available',
      version: '0.0.58',
      url: 'https://github.com/karlorz/orca-staging-test/releases/tag/mobile-android-v0.0.58-0'
    })
    expect(fetchImpl.mock.calls.map(([input]) => String(input))).toEqual([
      'https://api.github.com/repos/karlorz/orca-staging-test/git/matching-refs/tags/mobile-android-v',
      'https://api.github.com/repos/karlorz/orca-staging-test/releases/tags/mobile-android-v0.0.58-0'
    ])
  })
})

// A test-only list; the shipped allow-list stays karlorz/orca alone (asserted above).
const extendedListForSource = ['karlorz/orca', 'karlorz/orca-staging-test']
