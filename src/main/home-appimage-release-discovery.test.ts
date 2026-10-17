import { describe, expect, it, vi } from 'vitest'
import { discoverHomeAppImageRelease } from './home-appimage-release-discovery'
import { HOME_RELEASES_API_URL } from './home-appimage-release-request'
import { KARLORZ_FORK_RELEASE_FEED } from './updater-release-feeds'

function atomFeed(tags: string[]): string {
  return `<?xml version="1.0"?><feed>${tags
    .map(
      (tag) =>
        `<entry><link rel="alternate" type="text/html" href="https://github.com/karlorz/orca/releases/tag/${tag}"/></entry>`
    )
    .join('')}</feed>`
}

describe('home AppImage release discovery', () => {
  it('skips a missing SHA256SUMS probe and uses a later atom tag', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('api.github.com')) {
        return new Response('{"message":"Not Found"}', { status: 404 })
      }
      if (url === KARLORZ_FORK_RELEASE_FEED.repoAtomUrl) {
        return new Response(atomFeed(['v1.4.227-6', 'v1.4.224-1']))
      }
      if (url.endsWith('/v1.4.227-6/SHA256SUMS.txt')) {
        return new Response('Not Found', { status: 404 })
      }
      if (url.endsWith('/v1.4.224-1/SHA256SUMS.txt')) {
        return new Response('checksum fixture')
      }
      return new Response('miss', { status: 404 })
    })
    await expect(discoverHomeAppImageRelease(fetchImpl, 'v1.4.224-0')).resolves.toMatchObject({
      tag_name: 'v1.4.224-1'
    })
  })

  it('surfaces SHA256SUMS 503 as an error instead of no update', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('api.github.com')) {
        return new Response('{"message":"Not Found"}', { status: 404 })
      }
      if (url === KARLORZ_FORK_RELEASE_FEED.repoAtomUrl) {
        return new Response(
          atomFeed([
            'v1.4.227-6',
            'v1.4.227-5',
            'v1.4.227-4',
            'v1.4.227-3',
            'v1.4.227-2',
            'v1.4.227-1'
          ])
        )
      }
      if (url.endsWith('SHA256SUMS.txt')) {
        return new Response('unavailable', { status: 503 })
      }
      return new Response('miss', { status: 404 })
    })
    await expect(discoverHomeAppImageRelease(fetchImpl, 'v1.4.224-0')).rejects.toThrow(
      /atom fallback failed \(Fork update request failed \(503\).*SHA256SUMS\.txt/
    )
  })

  it('surfaces SHA256SUMS 429 as an error instead of no update', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('api.github.com')) {
        return new Response('{"message":"Not Found"}', { status: 404 })
      }
      if (url === KARLORZ_FORK_RELEASE_FEED.repoAtomUrl) {
        return new Response(atomFeed(['v1.4.227-6']))
      }
      if (url.endsWith('SHA256SUMS.txt')) {
        return new Response('rate limited', { status: 429 })
      }
      return new Response('miss', { status: 404 })
    })
    await expect(discoverHomeAppImageRelease(fetchImpl, 'v1.4.224-0')).rejects.toThrow(
      'Fork update request failed (429)'
    )
    expect(fetchImpl.mock.calls.some(([url]) => url === HOME_RELEASES_API_URL)).toBe(true)
  })
})
