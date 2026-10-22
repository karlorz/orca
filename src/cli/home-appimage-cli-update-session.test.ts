import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createProductionHomeAppImageCliUpdateSession,
  resolveHomeAppImageRoot,
  type HomeAppImageCliUpdateHost
} from './home-appimage-cli-update-session'
import {
  inspectHomeDaemonPidRecord,
  probeHomeDaemonState,
  probeLiveHomeDaemonProtocols,
  type HomeDaemonInventoryHost
} from './home-appimage-cli-daemon-inventory'
import { RuntimeClientError } from './runtime/types'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function host(overrides: Partial<HomeAppImageCliUpdateHost> = {}): HomeAppImageCliUpdateHost {
  const homeDir = '/tmp/orca-home-cli-update'
  return {
    platform: 'linux',
    arch: 'x64',
    env: {},
    homeDir,
    userDataPath: join(homeDir, 'profile'),
    cliVersion: '1.4.224-0',
    exists: () => false,
    fetch: async () => new Response(null, { status: 404 }),
    liveProtocols: async () => null,
    ...overrides
  }
}

async function daemonDir(): Promise<string> {
  const userData = await mkdtemp(join(tmpdir(), 'orca-cli-home-update-daemon-'))
  roots.push(userData)
  await mkdir(join(userData, 'daemon'), { recursive: true })
  return userData
}

function inventoryHost(
  files: Record<string, string>,
  inspect: HomeDaemonInventoryHost['inspectRecord'],
  query: HomeDaemonInventoryHost['queryInventory']
): HomeDaemonInventoryHost {
  return {
    readdir: async () => Object.keys(files),
    readPidFile: async (path) => {
      const name = path.split('/').at(-1) ?? path
      if (!(name in files)) {
        const error = new Error('missing') as NodeJS.ErrnoException
        error.code = 'ENOENT'
        throw error
      }
      return files[name]
    },
    inspectRecord: inspect,
    queryInventory: query
  }
}

describe('home AppImage CLI update session', () => {
  it('uses a managed APPIMAGE path inside HOME', () => {
    const homeDir = '/home/box'
    const image = join(homeDir, '.local', 'opt', 'orca', 'orca-linux.AppImage')
    expect(
      resolveHomeAppImageRoot(
        host({
          homeDir,
          env: { APPIMAGE: image, ORCA_HOME_INSTALL_MANAGED: '1' }
        })
      )
    ).toBe(join(homeDir, '.local', 'opt', 'orca'))
  })

  it('falls back to ~/.local/opt/orca when the image is present', () => {
    const homeDir = '/home/box'
    expect(
      resolveHomeAppImageRoot(
        host({
          homeDir,
          exists: (path) => path === join(homeDir, '.local', 'opt', 'orca', 'orca-linux.AppImage')
        })
      )
    ).toBe(join(homeDir, '.local', 'opt', 'orca'))
  })

  it('refuses when this machine has no home AppImage', () => {
    expect(() => resolveHomeAppImageRoot(host())).toThrow(RuntimeClientError)
  })

  it('refuses production sessions under Vitest so tests cannot touch the live pin', async () => {
    await expect(createProductionHomeAppImageCliUpdateSession(host())).rejects.toMatchObject({
      code: 'update_unavailable'
    })
  })

  it('reports verified live protocols from daemon inventory, not the pid filename alone', async () => {
    const query = vi.fn<(protocolVersion: number) => Promise<void>>(async () => undefined)
    expect(
      await probeLiveHomeDaemonProtocols(
        '/tmp/unused',
        inventoryHost(
          { 'daemon-v45.pid': JSON.stringify({ pid: 4242, linuxStartTicks: '99' }) },
          async () => 'live',
          query
        )
      )
    ).toEqual([45])
    expect(query).toHaveBeenCalledWith(45)
  })

  it('treats a stale reused PID as unverifiable rather than compatible', async () => {
    const userData = await daemonDir()
    await writeFile(
      join(userData, 'daemon', 'daemon-v45.pid'),
      JSON.stringify({ pid: process.pid, linuxStartTicks: '1' }),
      'utf8'
    )
    expect(await probeLiveHomeDaemonProtocols(userData)).toBeNull()
  })

  it('fails closed when a stale reused PID sits beside another verified generation', async () => {
    const query = vi.fn<(protocolVersion: number) => Promise<void>>(async () => undefined)
    expect(
      await probeLiveHomeDaemonProtocols(
        '/tmp/unused',
        inventoryHost(
          {
            'daemon-v44.pid': JSON.stringify({ pid: process.pid, linuxStartTicks: '1' }),
            'daemon-v45.pid': JSON.stringify({ pid: 4242, linuxStartTicks: '99' })
          },
          inspectHomeDaemonPidRecord,
          query
        )
      )
    ).toBeNull()
    expect(query).not.toHaveBeenCalled()
  })

  it('fails closed on an unreadable or corrupt pid record even when another generation answers', async () => {
    const query = vi.fn<(protocolVersion: number) => Promise<void>>(async () => undefined)
    const live = JSON.stringify({ pid: 4242, linuxStartTicks: '99' })
    expect(
      await probeLiveHomeDaemonProtocols(
        '/tmp/unused',
        inventoryHost(
          { 'daemon-v44.pid': '{"pid":', 'daemon-v45.pid': live },
          async () => 'live',
          query
        )
      )
    ).toBeNull()
    expect(query).not.toHaveBeenCalled()
    const error = Object.assign(new Error('denied'), { code: 'EACCES' })
    expect(
      await probeLiveHomeDaemonProtocols('/tmp/unused', {
        readdir: async () => ['daemon-v44.pid', 'daemon-v45.pid'],
        readPidFile: async (path) => {
          if (path.endsWith('daemon-v44.pid')) {
            throw error
          }
          return live
        },
        inspectRecord: async () => 'live',
        queryInventory: query
      })
    ).toBeNull()
    expect(query).not.toHaveBeenCalled()
  })

  it('includes every verified generation, including unknown newer protocols', async () => {
    const query = vi.fn<(protocolVersion: number) => Promise<void>>(async () => undefined)
    expect(
      await probeLiveHomeDaemonProtocols(
        '/tmp/unused',
        inventoryHost(
          {
            'daemon-v44.pid': JSON.stringify({ pid: 11, linuxStartTicks: '2' }),
            'daemon-v99.pid': JSON.stringify({ pid: 12, linuxStartTicks: '3' })
          },
          async () => 'live',
          query
        )
      )
    ).toEqual([44, 99])
    expect(query.mock.calls.map((call) => call[0])).toEqual([44, 99])
  })

  it('reports why the CLI inventory is unknown instead of a bare null', async () => {
    const missing = Object.assign(new Error('missing'), { code: 'ENOENT' })
    expect(
      await probeHomeDaemonState('/tmp/unused', {
        readdir: async () => {
          throw missing
        },
        readPidFile: async () => '',
        inspectRecord: async () => 'live',
        queryInventory: async () => undefined
      })
    ).toEqual({ protocols: null, reason: 'none-live', detail: 'no daemon directory' })
    const record = JSON.stringify({ pid: 4242, linuxStartTicks: '99' })
    expect(
      await probeHomeDaemonState(
        '/tmp/unused',
        inventoryHost(
          { 'daemon-v49.pid': record },
          async () => 'exited',
          async () => undefined
        )
      )
    ).toEqual({ protocols: null, reason: 'none-live', detail: 'no live daemon record' })
    expect(
      await probeHomeDaemonState(
        '/tmp/unused',
        inventoryHost(
          { 'daemon-v49.pid': record },
          async () => 'live',
          async () => {
            throw new Error('Daemon inventory timed out')
          }
        )
      )
    ).toEqual({ protocols: null, reason: 'timeout', detail: 'protocol 49' })
    expect(
      await probeHomeDaemonState(
        '/tmp/unused',
        inventoryHost(
          { 'daemon-v49.pid': record },
          async () => 'live',
          async () => {
            throw new Error('Daemon inventory socket failed')
          }
        )
      )
    ).toEqual({ protocols: null, reason: 'adapter-error', detail: 'protocol 49' })
  })
})
