import { vi, type Mock } from 'vitest'
import { isForkDesktopVersion } from '../shared/release-channel'

type UpdaterSpy = Mock<(...args: unknown[]) => unknown>

export type PrereleaseFeedMockFactory = {
  fetchNewerReleaseTagsWithReadiness: (...args: unknown[]) => Promise<unknown>
  fetchNewerForkDesktopReleaseTag: (...args: unknown[]) => Promise<unknown>
  getReleaseDownloadUrl: (tag: string) => string
  getReleaseDownloadUrlForFeed: (
    feed: { releaseDownloadBase?: string } | null | undefined,
    tag: string
  ) => string
  selectReleaseFeed: (currentVersion: string) => unknown
  STABLYAI_RELEASE_FEED: unknown
  KARLORZ_FORK_RELEASE_FEED: unknown
}

const STABLYAI_RELEASE_FEED = {
  repoAtomUrl: 'https://github.com/stablyai/orca/releases.atom',
  releaseDownloadBase: 'https://github.com/stablyai/orca/releases/download',
  tagHrefPattern: /href="https:\/\/github\.com\/stablyai\/orca\/releases\/tag\/([^"]+)"/,
  desktopTagPattern: /^v?\d+\.\d+\.\d+(?:-rc\.\d+(?:\.perf)?)?$/
}

const KARLORZ_FORK_RELEASE_FEED = {
  repoAtomUrl: 'https://github.com/karlorz/orca/releases.atom',
  releaseDownloadBase: 'https://github.com/karlorz/orca/releases/download',
  tagHrefPattern: /href="https:\/\/github\.com\/karlorz\/orca\/releases\/tag\/([^"]+)"/,
  desktopTagPattern: /^v\d+\.\d+\.\d+-\d+$/
}

export function createPrereleaseFeedMockFactory(
  fetchNewerReleaseTagsMock: UpdaterSpy
): PrereleaseFeedMockFactory {
  return {
    STABLYAI_RELEASE_FEED,
    KARLORZ_FORK_RELEASE_FEED,
    selectReleaseFeed: (currentVersion: string) =>
      isForkDesktopVersion(currentVersion) ? KARLORZ_FORK_RELEASE_FEED : STABLYAI_RELEASE_FEED,
    fetchNewerReleaseTagsWithReadiness: async (...args: unknown[]) => {
      const result = await fetchNewerReleaseTagsMock(...args)
      return Array.isArray(result)
        ? { tags: result, state: result.length > 0 ? 'ready' : 'no-newer' }
        : result
    },
    fetchNewerForkDesktopReleaseTag: vi.fn(async () => null),
    getReleaseDownloadUrl: (tag: string) =>
      `https://github.com/stablyai/orca/releases/download/${tag}`,
    getReleaseDownloadUrlForFeed: (
      feed: { releaseDownloadBase?: string } | null | undefined,
      tag: string
    ) =>
      `${(feed as { releaseDownloadBase?: string })?.releaseDownloadBase ?? 'https://github.com/stablyai/orca/releases/download'}/${tag}`
  }
}
