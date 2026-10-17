import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HomeAppImageUpdater } from './home-appimage-updater'
import type { UpdateStatus } from '../shared/update-status-types'
import { HOME_UPDATE_PROTOCOL_MESSAGE } from './home-appimage-release-policy'
import {
  HOME_GITHUB_API_VERSION,
  HOME_RELEASES_API_URL,
  HOME_UPDATER_USER_AGENT
} from './home-appimage-release-request'
import { KARLORZ_FORK_RELEASE_FEED } from './updater-release-feeds'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture(protocol = 44) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'orca-home-updater-'))
  roots.push(root)
  const tag = 'v1.4.224-1'
  const release = {
    tag_name: tag,
    draft: false,
    prerelease: true,
    assets: ['orca-linux.AppImage', 'SHA256SUMS.txt', 'orca-update-protocol.json'].map((name) => ({
      name,
      browser_download_url: `https://github.com/karlorz/orca/releases/download/${tag}/${name}`
    }))
  }
  const statuses: UpdateStatus[] = []
  const fetch = vi.fn(async (url: string) => {
    if (url.includes('api.github.com')) {
      return Response.json([release])
    }
    if (url.endsWith('.json')) {
      return Response.json({ schemaVersion: 1, tag, daemonProtocol: protocol })
    }
    return new Response(url.endsWith('.txt') ? 'checksum fixture' : 'AppImage bytes')
  })
  let installed = 'v1.4.224-0'
  const reconcile = vi.fn(async () => ({ tag: installed }))
  const commit = vi.fn(async (stage: string, next: string) => {
    expect(await readFile(path.join(stage, 'orca-linux.AppImage'), 'utf8')).toBe('AppImage bytes')
    installed = next
  })
  const unlock = vi.fn(async () => {})
  const restart = vi.fn(async () => {})
  const restartAborted = vi.fn()
  const liveProtocols = vi.fn(async (): Promise<number[] | null> => [44])
  const updater = new HomeAppImageUpdater({
    root,
    runningTag: installed,
    fetch,
    liveProtocols,
    reconcile,
    commit,
    lock: async () => unlock,
    sendStatus: (status) => statuses.push(status),
    restart,
    restartAborted,
    recordCheck: vi.fn()
  })
  return {
    updater,
    fetch,
    statuses,
    commit,
    restart,
    restartAborted,
    liveProtocols,
    reconcile,
    unlock
  }
}

describe('managed home updater actions', () => {
  it('checks, stages, commits and waits for an explicit restart action', async () => {
    const f = await fixture()
    await f.updater.check(true)
    expect(f.statuses.at(-1)?.state).toBe('available')
    await f.updater.download()
    expect(f.commit).toHaveBeenCalledTimes(1)
    expect(f.statuses.at(-1)).toEqual({ state: 'downloaded', version: '1.4.224-1' })
    expect(f.restart).not.toHaveBeenCalled()
    await f.updater.restart()
    expect(f.restart).toHaveBeenCalledTimes(1)
  })
  it('blocks download and restart on a protocol crossing', async () => {
    const f = await fixture(45)
    await f.updater.check(true)
    await f.updater.download()
    await f.updater.restart()
    expect(f.statuses.at(-1)).toMatchObject({
      state: 'error',
      message: HOME_UPDATE_PROTOCOL_MESSAGE,
      retryable: false
    })
    expect(f.commit).not.toHaveBeenCalled()
    expect(f.restart).not.toHaveBeenCalled()
    expect(f.fetch.mock.calls.some(([url]) => url.endsWith('.AppImage'))).toBe(false)
  })
  it('rechecks live protocol after download and before restart', async () => {
    const f = await fixture()
    await f.updater.check()
    await f.updater.download()
    f.liveProtocols.mockResolvedValue([45])
    await f.updater.restart()
    expect(f.restart).not.toHaveBeenCalled()
    expect(f.restartAborted).toHaveBeenCalledOnce()
    expect(f.statuses.at(-1)).toMatchObject({ state: 'error', retryable: false })
  })
  it('gates a previously committed image at startup before offering restart', async () => {
    const f = await fixture(45)
    f.reconcile.mockResolvedValue({ tag: 'v1.4.224-1' })
    await f.updater.check()
    expect(f.statuses.at(-1)).toMatchObject({ state: 'error', retryable: false })
    expect(f.statuses.some((status) => status.state === 'downloaded')).toBe(false)
    expect(f.restart).not.toHaveBeenCalled()
  })
  it('deduplicates concurrent checks and downloads', async () => {
    const f = await fixture()
    await Promise.all([f.updater.check(), f.updater.check(true)])
    await Promise.all([f.updater.download(), f.updater.download()])
    expect(f.commit).toHaveBeenCalledOnce()
  })
  it('preserves a newer pin committed by another updater before download', async () => {
    const f = await fixture()
    await f.updater.check()
    f.reconcile.mockResolvedValue({ tag: 'v1.4.224-2' })
    await f.updater.download()
    expect(f.commit).not.toHaveBeenCalled()
    expect(f.fetch.mock.calls.some(([url]) => url.endsWith('.AppImage'))).toBe(false)
  })
  it('fails closed when reconciliation cannot establish image identity', async () => {
    const f = await fixture()
    f.reconcile.mockRejectedValue(new Error('Saved image identity is unverifiable'))
    await f.updater.check()
    expect(f.fetch).not.toHaveBeenCalled()
    expect(f.statuses.at(-1)).toMatchObject({ state: 'error' })
    expect(f.unlock).toHaveBeenCalledOnce()
  })
  it('sends GitHub API headers, omits credentials, and follows redirects manually', async () => {
    const f = await fixture()
    await f.updater.check(true)
    const api = f.fetch.mock.calls.find(([url]) => url === HOME_RELEASES_API_URL)
    expect(api?.[0]).toBe(HOME_RELEASES_API_URL)
    const headers = new Headers(api?.[1]?.headers)
    expect(headers.get('User-Agent')).toBe(HOME_UPDATER_USER_AGENT)
    expect(headers.get('Accept')).toBe('application/vnd.github+json')
    expect(headers.get('X-GitHub-Api-Version')).toBe(HOME_GITHUB_API_VERSION)
    expect(api?.[1]?.credentials).toBe('omit')
    expect(api?.[1]?.redirect).toBe('manual')
    expect(f.fetch.mock.calls.some(([url]) => url.includes('/releases/latest'))).toBe(false)
  })
  it('reports the failing URL, status and body snippet when the API and atom feed 404', async () => {
    const f = await fixture()
    f.fetch.mockImplementation(async (url: string) => {
      if (url.includes('api.github.com')) {
        return new Response('{"message":"Not Found"}', { status: 404 })
      }
      if (url === KARLORZ_FORK_RELEASE_FEED.repoAtomUrl) {
        return new Response('Not Found', { status: 404 })
      }
      return new Response('miss', { status: 404 })
    })
    await f.updater.check(true)
    const status = f.statuses.at(-1)
    expect(status).toMatchObject({ state: 'error', retryable: true })
    const message = status?.state === 'error' ? status.message : ''
    expect(message).toContain(`Fork update request failed (404) ${HOME_RELEASES_API_URL}`)
    expect(message).toContain('{"message":"Not Found"}')
    expect(message).toContain('atom fallback failed')
    expect(message).toContain(KARLORZ_FORK_RELEASE_FEED.repoAtomUrl)
  })
  it('falls back to the prerelease atom feed when the releases API 404s', async () => {
    const f = await fixture()
    const tag = 'v1.4.224-1'
    const atom = `<?xml version="1.0"?><feed><entry><link rel="alternate" type="text/html" href="https://github.com/karlorz/orca/releases/tag/${tag}"/></entry></feed>`
    f.fetch.mockImplementation(async (url: string) => {
      if (url.includes('api.github.com')) {
        return new Response('{"message":"Not Found"}', { status: 404 })
      }
      if (url === KARLORZ_FORK_RELEASE_FEED.repoAtomUrl) {
        return new Response(atom)
      }
      if (url.endsWith('.json')) {
        return Response.json({ schemaVersion: 1, tag, daemonProtocol: 44 })
      }
      if (url.endsWith('SHA256SUMS.txt')) {
        return new Response('checksum fixture')
      }
      return new Response('miss', { status: 404 })
    })
    await f.updater.check(true)
    expect(f.statuses.at(-1)?.state).toBe('available')
    expect(f.statuses.at(-1)).toMatchObject({ version: '1.4.224-1' })
    expect(f.fetch.mock.calls.some(([url]) => url.includes('/releases/latest'))).toBe(false)
  })
  it('does not treat a 200 HTML atom body as an empty update feed', async () => {
    const f = await fixture()
    f.fetch.mockImplementation(async (url: string) => {
      if (url.includes('api.github.com')) {
        return new Response('{"message":"Not Found"}', { status: 404 })
      }
      if (url === KARLORZ_FORK_RELEASE_FEED.repoAtomUrl) {
        return new Response('<html>proxy interstitial</html>')
      }
      return new Response('miss', { status: 404 })
    })
    await f.updater.check(true)
    const status = f.statuses.at(-1)
    expect(status?.state).toBe('error')
    const message = status?.state === 'error' ? status.message : ''
    expect(message).toContain(`Fork update request failed (404) ${HOME_RELEASES_API_URL}`)
    expect(message).toContain('Invalid fork release atom feed')
  })
  it('follows a GitHub asset 302 when downloading the AppImage', async () => {
    const f = await fixture()
    await f.updater.check(true)
    const asset = 'https://github.com/karlorz/orca/releases/download/v1.4.224-1/orca-linux.AppImage'
    const storage = 'https://release-assets.githubusercontent.com/github-production-release-asset/1'
    f.fetch.mockImplementation(async (url: string) => {
      if (url.includes('api.github.com')) {
        return Response.json([])
      }
      if (url.endsWith('.json')) {
        return Response.json({ schemaVersion: 1, tag: 'v1.4.224-1', daemonProtocol: 44 })
      }
      if (url.endsWith('.txt')) {
        return new Response('checksum fixture')
      }
      if (url === asset) {
        return new Response(null, { status: 302, headers: { location: storage } })
      }
      if (url === storage) {
        return new Response('AppImage bytes')
      }
      return new Response('miss', { status: 404 })
    })
    await f.updater.download()
    expect(f.commit).toHaveBeenCalledTimes(1)
    expect(f.fetch.mock.calls.map(([url]) => url)).toContain(storage)
  })
})
