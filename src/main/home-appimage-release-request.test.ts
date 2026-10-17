import { describe, expect, it, vi } from 'vitest'
import {
  HOME_GITHUB_API_VERSION,
  HOME_RELEASES_API_URL,
  HOME_UPDATER_USER_AGENT,
  assertHomeUpdateUrl,
  fetchHomeUpdateResponse,
  formatForkUpdateRequestError,
  homeUpdateRequestHeaders,
  requireHomeUpdateResponse
} from './home-appimage-release-request'

describe('home AppImage GitHub request helper', () => {
  it('sends GitHub API headers only to api.github.com', () => {
    const api = homeUpdateRequestHeaders(HOME_RELEASES_API_URL)
    expect(api.get('User-Agent')).toBe(HOME_UPDATER_USER_AGENT)
    expect(api.get('Accept')).toBe('application/vnd.github+json')
    expect(api.get('X-GitHub-Api-Version')).toBe(HOME_GITHUB_API_VERSION)
    const asset = homeUpdateRequestHeaders(
      'https://github.com/karlorz/orca/releases/download/v1.4.227-6/orca-linux.AppImage'
    )
    expect(asset.get('User-Agent')).toBe(HOME_UPDATER_USER_AGENT)
    expect(asset.get('Accept')).toBeNull()
    expect(asset.get('X-GitHub-Api-Version')).toBeNull()
  })

  it('includes the failing URL, status and a short body snippet', () => {
    expect(formatForkUpdateRequestError(HOME_RELEASES_API_URL, 404, 'Not Found')).toBe(
      `Fork update request failed (404) ${HOME_RELEASES_API_URL}: Not Found`
    )
  })

  it('follows GitHub asset redirects and refuses foreign hosts', async () => {
    const asset = 'https://github.com/karlorz/orca/releases/download/v1.4.227-6/orca-linux.AppImage'
    const storage = 'https://objects.githubusercontent.com/github-production-release-asset/1'
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(init?.redirect).toBe('manual')
      expect(init?.credentials).toBe('omit')
      if (url === asset) {
        return new Response(null, { status: 302, headers: { location: storage } })
      }
      if (url === storage) {
        return new Response('AppImage bytes')
      }
      return new Response('miss', { status: 404 })
    })
    const response = await fetchHomeUpdateResponse(fetchImpl, asset, 5_000)
    expect(await response.text()).toBe('AppImage bytes')
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([asset, storage])
    await expect(
      fetchHomeUpdateResponse(
        async () =>
          new Response(null, { status: 302, headers: { location: 'https://example.com/steal' } }),
        asset,
        5_000
      )
    ).rejects.toThrow('outside the GitHub release hosts')
    expect(() => assertHomeUpdateUrl('http://github.com/karlorz/orca')).toThrow(
      'outside the GitHub release hosts'
    )
  })

  it('throws a diagnostic error on a non-OK API response', async () => {
    await expect(
      requireHomeUpdateResponse(
        async () => new Response('{"message":"Not Found"}', { status: 404 }),
        HOME_RELEASES_API_URL,
        5_000
      )
    ).rejects.toThrow(
      `Fork update request failed (404) ${HOME_RELEASES_API_URL}: {"message":"Not Found"}`
    )
  })
})
