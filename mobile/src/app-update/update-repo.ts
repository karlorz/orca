import { KARLORZ_FORK_REPO } from '../../../src/shared/release-channel'

/** The repo the Android updater reads when neither the build nor a developer says otherwise. */
export const DEFAULT_MOBILE_UPDATE_REPO = KARLORZ_FORK_REPO

// TODO(karl): staging slot. Put the real staging fork's 'owner/repo' here when one exists. Left
// empty on purpose (no staging repo is invented); while empty it is not on the allow-list.
export const MOBILE_UPDATE_STAGING_REPO = ''

/**
 * ALLOW-LIST: the only repos the development override may point the Android updater at. Today that
 * is karlorz/orca alone. The Troubleshooting row offers exactly these and a stored value outside the
 * list is ignored. To add staging, fill MOBILE_UPDATE_STAGING_REPO above; nothing else changes.
 */
export const MOBILE_UPDATE_REPO_ALLOW_LIST: readonly string[] = [
  DEFAULT_MOBILE_UPDATE_REPO,
  ...(MOBILE_UPDATE_STAGING_REPO ? [MOBILE_UPDATE_STAGING_REPO] : [])
]

/** True when `repo` is a well-formed slug on the allow-list. */
export function isAllowedMobileUpdateRepo(
  repo: string | null | undefined,
  allowList: readonly string[] = MOBILE_UPDATE_REPO_ALLOW_LIST
): boolean {
  const parsed = parseMobileUpdateRepo(repo)
  return parsed !== null && allowList.includes(parsed)
}

// GitHub's own shapes: an owner is 1-39 alphanumerics or single inner hyphens; a repo name is
// 1-100 of [A-Za-z0-9._-]. Anything else cannot name a repo, so it never reaches a URL.
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/
const REPO = /^[A-Za-z0-9._-]{1,100}$/

/**
 * `owner/repo` when the input names a GitHub repo, else null.
 *
 * Only the bare slug is accepted, never a URL: the updater always talks to `api.github.com`, and a
 * field that took a host would let a typo point the APK trust path somewhere else.
 */
export function parseMobileUpdateRepo(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') {
    return null
  }
  const parts = raw.trim().split('/')
  if (parts.length !== 2) {
    return null
  }
  const [owner, repo] = parts
  if (!OWNER.test(owner) || !REPO.test(repo) || repo === '.' || repo === '..') {
    return null
  }
  return `${owner}/${repo}`
}

/**
 * The update repo this binary was built for, and the only place the build-time constant is spelled.
 *
 * babel-preset-expo's inline-env-vars plugin replaces only the literal
 * `process.env.EXPO_PUBLIC_MOBILE_UPDATE_REPO` member expression (a destructure or copy reads
 * `undefined` on a device), so every caller goes through here. Unset, empty, malformed or off the allow-list is the fork
 * default, so a build that never heard of the variable behaves exactly as before.
 */
export function buildTimeMobileUpdateRepo(): string {
  const repo = parseMobileUpdateRepo(process.env.EXPO_PUBLIC_MOBILE_UPDATE_REPO)
  return repo && isAllowedMobileUpdateRepo(repo) ? repo : DEFAULT_MOBILE_UPDATE_REPO
}

export function mobileUpdateRepoApi(repo: string): string {
  return `https://api.github.com/repos/${repo}`
}

export function mobileUpdateReleasesPage(repo: string): string {
  return `https://github.com/${repo}/releases`
}

export type ResolveMobileUpdateRepoDeps = {
  /** True only in a development build; a release never honours a stored override. */
  readonly allowOverride: boolean
  readonly loadOverride: () => Promise<string | null>
  readonly buildTimeRepo: () => string
  /** Defaults to MOBILE_UPDATE_REPO_ALLOW_LIST; injectable for tests. */
  readonly allowList?: readonly string[]
}

/**
 * The repo a check should read: an allow-listed developer override in a development build,
 * otherwise the build-time repo. A store that fails, holds junk or holds a repo off the allow-list
 * falls back rather than failing the check.
 */
export async function resolveMobileUpdateRepo(deps: ResolveMobileUpdateRepoDeps): Promise<string> {
  if (deps.allowOverride) {
    try {
      const override = parseMobileUpdateRepo(await deps.loadOverride())
      if (override && isAllowedMobileUpdateRepo(override, deps.allowList)) {
        return override
      }
    } catch {
      // Fall through to the build default.
    }
  }
  return deps.buildTimeRepo()
}
