import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HomeLiveDaemonState } from '../../main/home-appimage-release-policy'
import { HomeAppImageUpdater } from '../../main/home-appimage-updater'
import type { UpdateStatus } from '../../shared/update-status-types'
import type { HandlerContext } from '../dispatch'
import {
  configureHomeAppImageCliUpdate,
  type HomeAppImageCliUpdateSession
} from '../home-appimage-cli-update'
import { UPDATE_HANDLERS } from './update'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  vi.restoreAllMocks()
})

async function fixture(
  protocol = 44,
  currentTag = 'v1.4.224-0',
  live: () => Promise<readonly number[] | HomeLiveDaemonState | null> = async () => [44],
  metadata?: () => Promise<Response>
) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'orca-cli-home-update-'))
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
  const fetch = vi.fn(async (url: string) => {
    if (url.includes('api.github.com')) {
      return Response.json([release])
    }
    if (url.endsWith('.json')) {
      return metadata
        ? metadata()
        : Response.json({ schemaVersion: 1, tag, daemonProtocol: protocol })
    }
    return new Response(url.endsWith('.txt') ? 'checksum fixture' : 'AppImage bytes')
  })
  let installed = currentTag
  let reconcileTag = currentTag
  const reconcile = vi.fn(async () => ({ tag: reconcileTag }))
  const commit = vi.fn(async (stage: string, next: string) => {
    expect(await readFile(path.join(stage, 'orca-linux.AppImage'), 'utf8')).toBe('AppImage bytes')
    installed = next
    reconcileTag = next
  })
  const session = (): HomeAppImageCliUpdateSession => ({
    runningTag: currentTag,
    readInstalledTag: async () => installed,
    createUpdater: (sendStatus: (status: UpdateStatus) => void) =>
      new HomeAppImageUpdater({
        root,
        runningTag: currentTag,
        fetch,
        liveProtocols: live,
        reconcile,
        commit,
        lock: async () => async () => {},
        sendStatus,
        restart: async () => undefined,
        restartAborted: () => undefined,
        recordCheck: vi.fn()
      })
  })
  return {
    fetch,
    commit,
    reconcile,
    session,
    setInstalled: (next: string) => {
      installed = next
    }
  }
}

async function run(command: 'update check' | 'update apply', json = false): Promise<string> {
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
  const ctx: HandlerContext = {
    flags: new Map(),
    client: { call: vi.fn() } as never,
    cwd: '/tmp',
    json
  }
  await UPDATE_HANDLERS[command](ctx)
  return String(log.mock.calls.at(-1)?.[0] ?? '')
}

describe('orca update check|apply', () => {
  it('reports an available newer home AppImage', async () => {
    const f = await fixture()
    const restore = configureHomeAppImageCliUpdate(async () => f.session())
    try {
      const text = await run('update check')
      expect(text).toContain('Update available: 1.4.224-1 (v1.4.224-1)')
      expect(text).toContain('Installed pin: v1.4.224-0')
      expect(f.commit).not.toHaveBeenCalled()
    } finally {
      restore()
    }
  })

  it('reports when the feed has no newer pin', async () => {
    const f = await fixture(44, 'v1.4.224-1')
    const restore = configureHomeAppImageCliUpdate(async () => f.session())
    try {
      expect(await run('update check')).toContain('No newer home AppImage is available.')
      expect(JSON.parse(await run('update check', true)).result.state).toBe('not-available')
    } finally {
      restore()
    }
  })

  it('applies by downloading and committing the selected pin without restart', async () => {
    const f = await fixture()
    const restore = configureHomeAppImageCliUpdate(async () => f.session())
    try {
      const text = await run('update apply')
      expect(f.commit).toHaveBeenCalledTimes(1)
      expect(text).toContain('Downloaded and committed v1.4.224-1')
      expect(text).toContain('does not relaunch')
      expect(JSON.parse(await run('update check', true)).result.state).toBe('downloaded')
    } finally {
      restore()
    }
  })

  it('refuses apply when the installed pin is already at least as new', async () => {
    const f = await fixture()
    const restore = configureHomeAppImageCliUpdate(async () => f.session())
    try {
      f.setInstalled('v1.4.224-1')
      await expect(run('update apply')).rejects.toMatchObject({
        code: 'update_downgrade_refused',
        data: expect.objectContaining({
          installedTag: 'v1.4.224-1',
          selectedTag: 'v1.4.224-1',
          retryable: false
        })
      })
      expect(f.commit).not.toHaveBeenCalled()
      expect(f.fetch.mock.calls.some(([url]) => url.endsWith('.AppImage'))).toBe(false)
    } finally {
      restore()
    }
  })

  it('maps the updater pin-advanced guard to a downgrade refusal', async () => {
    const f = await fixture()
    let reconcileCalls = 0
    f.reconcile.mockImplementation(async () => ({
      tag: ++reconcileCalls === 1 ? 'v1.4.224-0' : 'v1.4.224-2'
    }))
    const restore = configureHomeAppImageCliUpdate(async () => f.session())
    try {
      await expect(run('update apply')).rejects.toMatchObject({
        code: 'update_downgrade_refused'
      })
      expect(f.commit).not.toHaveBeenCalled()
      expect(f.fetch.mock.calls.some(([url]) => url.endsWith('.AppImage'))).toBe(false)
    } finally {
      restore()
    }
  })

  it('disables apply on a daemon protocol mismatch without downloading', async () => {
    const f = await fixture(45)
    const restore = configureHomeAppImageCliUpdate(async () => f.session())
    try {
      await expect(run('update apply')).rejects.toMatchObject({
        code: 'update_protocol_required',
        message: expect.stringContaining('v1.4.224-1 needs daemon protocol 45; live daemons: 44'),
        data: expect.objectContaining({ retryable: false })
      })
      expect(f.commit).not.toHaveBeenCalled()
      expect(f.fetch.mock.calls.some(([url]) => url.endsWith('.AppImage'))).toBe(false)
    } finally {
      restore()
    }
  })

  it('reports unknown daemon state as its own retryable code and still refuses apply', async () => {
    const f = await fixture(44, 'v1.4.224-0', async () => ({
      protocols: null,
      reason: 'none-live',
      detail: 'refused: protocol 44, 45'
    }))
    const restore = configureHomeAppImageCliUpdate(async () => f.session())
    try {
      await expect(run('update check')).rejects.toMatchObject({
        code: 'update_daemon_state_unknown',
        message: expect.stringContaining('none-live'),
        data: expect.objectContaining({ retryable: true })
      })
      await expect(run('update apply')).rejects.toMatchObject({
        code: 'update_daemon_state_unknown'
      })
      expect(f.commit).not.toHaveBeenCalled()
      expect(f.fetch.mock.calls.some(([url]) => url.endsWith('.AppImage'))).toBe(false)
    } finally {
      restore()
    }
  })

  it('reports a failed metadata fetch as retryable metadata-unavailable, not attended', async () => {
    const f = await fixture(
      44,
      'v1.4.224-0',
      async () => [44],
      async () => {
        throw new Error('getaddrinfo EAI_AGAIN https://objects.githubusercontent.com/x?sig=secret')
      }
    )
    const restore = configureHomeAppImageCliUpdate(async () => f.session())
    try {
      const error = await run('update check').catch((caught: unknown) => caught)
      expect(error).toMatchObject({
        code: 'update_protocol_metadata_unavailable',
        data: expect.objectContaining({ retryable: true })
      })
      expect((error as Error).message).toContain('EAI_AGAIN')
      expect((error as Error).message).not.toContain('sig=secret')
      expect(f.commit).not.toHaveBeenCalled()
    } finally {
      restore()
    }
  })

  it('keeps a release without protocol metadata attended', async () => {
    const f = await fixture(
      44,
      'v1.4.224-0',
      async () => [44],
      async () => new Response('Not Found', { status: 404 })
    )
    const restore = configureHomeAppImageCliUpdate(async () => f.session())
    try {
      await expect(run('update check')).rejects.toMatchObject({
        code: 'update_protocol_required',
        message: expect.stringContaining('publishes no orca-update-protocol.json'),
        data: expect.objectContaining({ retryable: false })
      })
    } finally {
      restore()
    }
  })
})
