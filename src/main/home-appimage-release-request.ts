const MAX_REDIRECTS = 8
const BODY_SNIPPET_CHARS = 180
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const GITHUB_RELEASE_CDN_HOSTS = new Set([
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'github-releases.githubusercontent.com'
])
const HOME_GITHUB_REPO_PREFIX = '/karlorz/orca/'
const HOME_RELEASES_API_PATH = '/repos/karlorz/orca/releases'

export const HOME_UPDATER_USER_AGENT = 'karlorz-orca-home-updater'
export const HOME_GITHUB_API_VERSION = '2022-11-28'
export const HOME_RELEASES_API_URL =
  'https://api.github.com/repos/karlorz/orca/releases?per_page=100'

export type HomeUpdateFetch = (url: string, init?: RequestInit) => Promise<Response>

export function assertHomeUpdateUrl(url: string): URL {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('Fork update URL is invalid')
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error('Fork update URL is outside the GitHub release hosts')
  }
  const { hostname, pathname } = parsed
  if (hostname === 'api.github.com') {
    if (pathname !== HOME_RELEASES_API_PATH || parsed.hash) {
      throw new Error('Fork update URL is outside the GitHub release hosts')
    }
    return parsed
  }
  if (hostname === 'github.com') {
    // Why no search/hash: GitHub open-redirects live in query strings; keep hops on this repo.
    if (
      parsed.search ||
      parsed.hash ||
      !(
        pathname === `${HOME_GITHUB_REPO_PREFIX}releases.atom` ||
        pathname.startsWith(`${HOME_GITHUB_REPO_PREFIX}releases/download/`)
      )
    ) {
      throw new Error('Fork update URL is outside the GitHub release hosts')
    }
    return parsed
  }
  if (GITHUB_RELEASE_CDN_HOSTS.has(hostname)) {
    return parsed
  }
  throw new Error('Fork update URL is outside the GitHub release hosts')
}

export function homeUpdateRequestHeaders(url: string): Headers {
  const headers = new Headers({ 'User-Agent': HOME_UPDATER_USER_AGENT })
  if (new URL(url).hostname === 'api.github.com') {
    headers.set('Accept', 'application/vnd.github+json')
    headers.set('X-GitHub-Api-Version', HOME_GITHUB_API_VERSION)
  }
  return headers
}

export function formatForkUpdateRequestError(url: string, status: number, snippet: string): string {
  const body = snippet ? `: ${snippet}` : ''
  return `Fork update request failed (${status}) ${url}${body}`
}

export async function readHomeUpdateBodySnippet(response: Response): Promise<string> {
  try {
    return (await response.text()).replace(/\s+/g, ' ').trim().slice(0, BODY_SNIPPET_CHARS)
  } catch {
    return ''
  }
}

export async function fetchHomeUpdateResponse(
  fetchImpl: HomeUpdateFetch,
  url: string,
  timeoutMs: number
): Promise<Response> {
  const signal = AbortSignal.timeout(timeoutMs)
  let current = assertHomeUpdateUrl(url).href
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await fetchImpl(current, {
      method: 'GET',
      redirect: 'manual',
      credentials: 'omit',
      signal,
      headers: homeUpdateRequestHeaders(current)
    })
    if (!REDIRECT_STATUSES.has(response.status)) {
      return response
    }
    const location = response.headers.get('location')
    await response.body?.cancel().catch(() => undefined)
    if (!location) {
      return response
    }
    current = assertHomeUpdateUrl(new URL(location, current).href).href
  }
  throw new Error(`Fork update request exceeded the redirect limit ${url}`)
}

export async function requireHomeUpdateResponse(
  fetchImpl: HomeUpdateFetch,
  url: string,
  timeoutMs: number
): Promise<Response> {
  const response = await fetchHomeUpdateResponse(fetchImpl, url, timeoutMs)
  if (response.ok) {
    return response
  }
  const snippet = await readHomeUpdateBodySnippet(response)
  throw new Error(formatForkUpdateRequestError(url, response.status, snippet))
}
