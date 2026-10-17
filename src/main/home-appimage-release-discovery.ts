import {
  compareHomeReleaseTags,
  homeReleaseAssetUrl,
  homeReleaseFromDesktopTag,
  parseHomeDesktopTagsFromAtom,
  selectHomeAppImageRelease,
  type HomeAppImageRelease
} from './home-appimage-release-policy'
import {
  HOME_RELEASES_API_URL,
  fetchHomeUpdateResponse,
  formatForkUpdateRequestError,
  readHomeUpdateBodySnippet,
  requireHomeUpdateResponse,
  type HomeUpdateFetch
} from './home-appimage-release-request'
import { readFetchResponseTextWithinLimit } from '../shared/fetch-response-body'
import { KARLORZ_FORK_RELEASE_FEED } from './updater-release-feeds'

const DEFAULT_FETCH_TIMEOUT_MS = 15_000
const MAX_ATOM_PROBE_TAGS = 6
const ATOM_FEED_MAX_BYTES = 256 * 1024

type ReleaseDiscovery =
  | { ok: true; release: HomeAppImageRelease | null }
  | { ok: false; error: string }

function discoveryError(error: unknown): ReleaseDiscovery {
  return { ok: false, error: error instanceof Error ? error.message : String(error) }
}

async function discoverFromApi(
  fetchImpl: HomeUpdateFetch,
  runningTag: string
): Promise<ReleaseDiscovery> {
  try {
    const response = await requireHomeUpdateResponse(
      fetchImpl,
      HOME_RELEASES_API_URL,
      DEFAULT_FETCH_TIMEOUT_MS
    )
    return {
      ok: true,
      release: selectHomeAppImageRelease(await response.json(), runningTag)
    }
  } catch (error) {
    return discoveryError(error)
  }
}

async function discoverFromAtom(
  fetchImpl: HomeUpdateFetch,
  runningTag: string
): Promise<ReleaseDiscovery> {
  try {
    const response = await requireHomeUpdateResponse(
      fetchImpl,
      KARLORZ_FORK_RELEASE_FEED.repoAtomUrl,
      DEFAULT_FETCH_TIMEOUT_MS
    )
    const tags = parseHomeDesktopTagsFromAtom(
      await readFetchResponseTextWithinLimit(response, ATOM_FEED_MAX_BYTES)
    ).filter((tag) => compareHomeReleaseTags(tag, runningTag) > 0)
    for (const tag of tags.slice(0, MAX_ATOM_PROBE_TAGS)) {
      const release = homeReleaseFromDesktopTag(tag)
      const sumsUrl = homeReleaseAssetUrl(release, 'SHA256SUMS.txt')
      const sums = await fetchHomeUpdateResponse(fetchImpl, sumsUrl, DEFAULT_FETCH_TIMEOUT_MS)
      if (sums.ok) {
        await sums.body?.cancel().catch(() => undefined)
        return { ok: true, release }
      }
      const snippet = await readHomeUpdateBodySnippet(sums)
      if (sums.status !== 404) {
        return { ok: false, error: formatForkUpdateRequestError(sumsUrl, sums.status, snippet) }
      }
    }
    return { ok: true, release: null }
  } catch (error) {
    return discoveryError(error)
  }
}

export async function discoverHomeAppImageRelease(
  fetchImpl: HomeUpdateFetch,
  runningTag: string
): Promise<HomeAppImageRelease | null> {
  const api = await discoverFromApi(fetchImpl, runningTag)
  if (api.ok) {
    return api.release
  }
  const atom = await discoverFromAtom(fetchImpl, runningTag)
  if (atom.ok) {
    return atom.release
  }
  throw new Error(`${api.error}; atom fallback failed (${atom.error})`)
}

export { DEFAULT_FETCH_TIMEOUT_MS }
