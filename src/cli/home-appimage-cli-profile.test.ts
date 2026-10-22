import { describe, expect, it, vi } from 'vitest'
import { resolveHomeUpdateProfiles, type HomeUpdateProcessHost } from './home-appimage-cli-profile'
import { probeHomeUpdateProfiles } from './home-appimage-cli-update-session'

const homeDir = '/home/karl'
const image = '/home/karl/.local/opt/orca/orca-linux.AppImage'

function processes(table: Record<string, { argv: string[]; exe?: string }>): HomeUpdateProcessHost {
  return {
    listPids: async () => Object.keys(table),
    readCmdline: async (pid) => `${table[pid].argv.join('\0')}\0`,
    readExe: async (pid) => {
      const exe = table[pid].exe
      if (!exe) {
        throw Object.assign(new Error('denied'), { code: 'EACCES' })
      }
      return exe
    }
  }
}

describe('home AppImage CLI profile resolution', () => {
  it('honours ORCA_USER_DATA_PATH before anything else', async () => {
    const listPids = vi.fn(async () => [])
    expect(
      await resolveHomeUpdateProfiles({
        env: { ORCA_USER_DATA_PATH: '/home/karl/orca-ide-profile/Fork-5' },
        platform: 'linux',
        homeDir,
        image,
        processes: { listPids, readCmdline: vi.fn(), readExe: vi.fn() }
      })
    ).toEqual({ source: 'env', userDataPaths: ['/home/karl/orca-ide-profile/Fork-5'] })
    expect(listPids).not.toHaveBeenCalled()
  })

  it("uses the running managed AppImage's --user-data-dir, ignoring renderers and other apps", async () => {
    const profiles = await resolveHomeUpdateProfiles({
      env: {},
      platform: 'linux',
      homeDir,
      image,
      processes: processes({
        '10': {
          argv: [image, '--no-sandbox', '--user-data-dir=/home/karl/orca-ide-profile/Fork-5'],
          exe: image
        },
        '11': {
          argv: [
            '/tmp/appimage_extracted_x/orca-ide',
            '--type=renderer',
            '--user-data-dir=/elsewhere'
          ],
          exe: '/tmp/appimage_extracted_x/orca-ide'
        },
        '12': { argv: ['/usr/bin/google-chrome', '--user-data-dir=/home/karl/chrome-profile'] },
        '13': { argv: ['bash'], exe: '/usr/bin/bash' }
      })
    })
    expect(profiles).toEqual({
      source: 'running-app',
      userDataPaths: ['/home/karl/orca-ide-profile/Fork-5']
    })
  })

  it('matches by exe when argv[0] was rewritten, and probes every running profile', async () => {
    const profiles = await resolveHomeUpdateProfiles({
      env: {},
      platform: 'linux',
      homeDir,
      image,
      processes: processes({
        '20': { argv: ['orca', '--user-data-dir=/p/b'], exe: image },
        '21': { argv: [image, '--user-data-dir=/p/a'] }
      })
    })
    expect(profiles).toEqual({ source: 'running-app', userDataPaths: ['/p/a', '/p/b'] })
  })

  it('falls back to the platform default when no managed AppImage names a profile', async () => {
    expect(
      await resolveHomeUpdateProfiles({
        env: { XDG_CONFIG_HOME: '' },
        platform: 'linux',
        homeDir,
        image,
        processes: processes({ '30': { argv: [image, '--no-sandbox'], exe: image } })
      })
    ).toEqual({ source: 'default', userDataPaths: [expect.stringMatching(/\/orca$/)] })
  })

  it('blocks on the first unverifiable profile and names it, never passing an empty union', async () => {
    const probe = vi.fn(async (path: string) =>
      path === '/p/a'
        ? { protocols: [49] }
        : { protocols: null, reason: 'none-live' as const, detail: 'no daemon directory' }
    )
    expect(
      await probeHomeUpdateProfiles(
        { source: 'running-app', userDataPaths: ['/p/a', '/p/b'] },
        probe
      )
    ).toEqual({
      protocols: null,
      reason: 'none-live',
      detail: 'no daemon directory; profile /p/b from running-app'
    })
    expect(
      await probeHomeUpdateProfiles({ source: 'env', userDataPaths: ['/p/a'] }, probe)
    ).toEqual({ protocols: [49] })
  })
})
