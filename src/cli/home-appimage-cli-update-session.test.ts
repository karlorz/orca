import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION } from '../main/daemon/daemon-protocol-version'
import {
  createProductionHomeAppImageCliUpdateSession,
  probeLiveHomeDaemonProtocols,
  resolveHomeAppImageRoot,
  type HomeAppImageCliUpdateHost
} from './home-appimage-cli-update-session'
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

  it('reports live daemon protocol versions from pid files', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'orca-cli-home-update-daemon-'))
    roots.push(userData)
    const runtimeDir = join(userData, 'daemon')
    await mkdir(runtimeDir, { recursive: true })
    await writeFile(
      join(runtimeDir, `daemon-v${PROTOCOL_VERSION}.pid`),
      JSON.stringify({ pid: process.pid }),
      'utf8'
    )
    expect(await probeLiveHomeDaemonProtocols(userData)).toEqual([PROTOCOL_VERSION])
    expect(await probeLiveHomeDaemonProtocols(join(userData, 'missing'))).toBeNull()
  })
})
