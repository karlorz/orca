import { z } from 'zod'
import { compareAppVersions } from '../../../src/shared/app-version'
import type { AppUpdateCheckResult, AppUpdateSource } from './app-update-source'
import { isNewerReleaseVersion } from './app-update-source'
import {
  DEFAULT_MOBILE_UPDATE_REPO,
  mobileUpdateReleasesPage,
  mobileUpdateRepoApi
} from './update-repo'

/** The default repo's API and releases page; a check reads whichever repo it is handed. */
export const MOBILE_ANDROID_RELEASE_REPO_API = mobileUpdateRepoApi(DEFAULT_MOBILE_UPDATE_REPO)
export const MOBILE_ANDROID_RELEASES_PAGE = mobileUpdateReleasesPage(DEFAULT_MOBILE_UPDATE_REPO)
// Why tag refs, not releases.atom or /releases?per_page=100: both are newest-first windows that a
// run of desktop releases fills, pushing the newest mobile release out and reading as "current".
// The release `prerelease` flag is not a filter: every mobile-android-v* release is published as one.
const TAG_PREFIX = 'mobile-android-v'
// Fork tags are mobile-android-vX.Y.Z-N; installed expo.version is the train X.Y.Z.
const MOBILE_ANDROID_TAG_VERSION = /^(\d+\.\d+\.\d+)(?:-\d+)?$/
// Why: the release workflow pushes the tag before the APK build, so a failed build leaves a
// tag with no release; probe a few older candidates, bounded like the desktop's manifest probe.
const MAX_RELEASE_PROBES = 3

/** Train X.Y.Z from a fork suffix tag or a bare upstream-style tag; rejects -rc.N. */
export function mobileAndroidTrainVersion(tagVersion: string): string | null {
  return tagVersion.match(MOBILE_ANDROID_TAG_VERSION)?.[1] ?? null
}

/** True when the candidate tag's train is newer than the installed expo.version train. */
export function isNewerMobileAndroidRelease(candidate: string, installed: string): boolean {
  const candidateTrain = mobileAndroidTrainVersion(candidate)
  const installedTrain = mobileAndroidTrainVersion(installed)
  return (
    candidateTrain !== null &&
    installedTrain !== null &&
    isNewerReleaseVersion(candidateTrain, installedTrain)
  )
}

type Fetch = typeof fetch

const tagRefsSchema = z.array(z.looseObject({ ref: z.string() }))
const installableReleaseSchema = z.looseObject({
  draft: z.literal(false),
  html_url: z.string(),
  assets: z.array(z.looseObject({ name: z.string() }))
})

/** Versions named by the tag refs GitHub returns for the mobile-android prefix. */
export function parseMobileAndroidTagVersions(refs: unknown): string[] {
  const prefix = `refs/tags/${TAG_PREFIX}`
  return tagRefsSchema
    .parse(refs)
    .filter(({ ref }) => ref.startsWith(prefix))
    .map(({ ref }) => ref.slice(prefix.length))
}

/** The release page when the tag has a published release carrying an APK, else null. */
export function installableReleaseUrl(release: unknown): string | null {
  const parsed = installableReleaseSchema.safeParse(release)
  return parsed.success && parsed.data.assets.some((asset) => asset.name.endsWith('.apk'))
    ? parsed.data.html_url
    : null
}

/**
 * `resolveRepo` is asked once per check, so a changed developer override applies to the next check
 * without rebuilding the source. It defaults to the fork repo, which keeps old callers unchanged.
 */
export function createGithubReleaseUpdateSource(
  fetchImpl: Fetch,
  resolveRepo: () => string | Promise<string> = () => DEFAULT_MOBILE_UPDATE_REPO
): AppUpdateSource {
  return {
    async check(installedVersion, signal): Promise<AppUpdateCheckResult> {
      const repoApi = mobileUpdateRepoApi(await resolveRepo())
      const refsReply = await fetchImpl(`${repoApi}/git/matching-refs/tags/${TAG_PREFIX}`, {
        signal
      })
      if (!refsReply.ok) {
        throw new Error(`tag refs HTTP ${refsReply.status}`)
      }
      const candidates = parseMobileAndroidTagVersions(await refsReply.json())
        .filter((version) => isNewerMobileAndroidRelease(version, installedVersion))
        .sort((left, right) => compareAppVersions(right, left))
        .slice(0, MAX_RELEASE_PROBES)
      for (const version of candidates) {
        const releaseReply = await fetchImpl(
          `${repoApi}/releases/tags/${encodeURIComponent(`${TAG_PREFIX}${version}`)}`,
          { signal }
        )
        if (releaseReply.status === 404) {
          continue
        }
        if (!releaseReply.ok) {
          throw new Error(`release HTTP ${releaseReply.status}`)
        }
        const url = installableReleaseUrl(await releaseReply.json())
        const train = mobileAndroidTrainVersion(version)
        if (url && train) {
          return { kind: 'available', version: train, url }
        }
      }
      return { kind: 'current' }
    }
  }
}
