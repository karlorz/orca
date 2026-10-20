import path from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { appMock, createUpdaterMock } = vi.hoisted(() => ({
  appMock: { getVersion: vi.fn(() => '1.4.229-10'), relaunch: vi.fn(), quit: vi.fn() },
  createUpdaterMock: vi.fn(function () {})
}))

vi.mock('electron', () => ({ app: appMock }))
vi.mock('./daemon/daemon-provider-state', () => ({ getDaemonProvider: vi.fn() }))
vi.mock('./daemon/daemon-provider-routing', () => ({ getAllDaemonAdapters: vi.fn() }))
vi.mock('./home-appimage-electron-fetch', () => ({ fetchHomeUpdateViaElectron: vi.fn() }))
vi.mock('./home-appimage-updater', () => ({ HomeAppImageUpdater: createUpdaterMock }))
vi.mock('./orca-home-appimage-install', () => ({
  acquireHomeAppImageLock: vi.fn(),
  commitHomeAppImage: vi.fn(),
  reconcileHomeAppImage: vi.fn()
}))

import { createHomeAppImageUpdater, relaunchHomeAppImage } from './home-appimage-runtime'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('APPIMAGE', undefined)
  vi.stubEnv('APPIMAGE_EXTRACT_AND_RUN', undefined)
  vi.stubEnv('ORCA_HOME_INSTALL_MANAGED', undefined)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const root = path.join(tmpdir(), 'orca-home-runtime', '.local', 'opt', 'orca')
const image = path.join(root, 'orca-linux.AppImage')

describe('recovered home AppImage runtime', () => {
  it('uses the resolved install root even when APPIMAGE is absent', () => {
    createHomeAppImageUpdater(image, {
      sendStatus: vi.fn(),
      restart: vi.fn(),
      restartAborted: vi.fn(),
      recordCheck: vi.fn()
    })
    expect(createUpdaterMock).toHaveBeenCalledWith(
      expect.objectContaining({ root, runningTag: 'v1.4.229-10' })
    )
    expect(process.env.APPIMAGE).toBeUndefined()
  })

  it('restarts the installed image rather than the old cached executable, preserving profile arguments', () => {
    vi.stubGlobal('process', {
      ...process,
      argv: ['old-cached-executable', '--user-data-dir=profile with spaces', '--no-sandbox']
    })
    relaunchHomeAppImage(image)
    expect(appMock.relaunch).toHaveBeenCalledWith({
      execPath: image,
      args: ['--user-data-dir=profile with spaces', '--no-sandbox']
    })
    expect(process.env.APPIMAGE_EXTRACT_AND_RUN).toBe('1')
    expect(process.env.ORCA_HOME_INSTALL_MANAGED).toBe('1')
    expect(appMock.quit).toHaveBeenCalledOnce()
    expect(appMock.relaunch.mock.invocationCallOrder[0]).toBeLessThan(
      appMock.quit.mock.invocationCallOrder[0]
    )
  })

  it('preserves the launcher runtime settings when APPIMAGE is present', () => {
    vi.stubEnv('APPIMAGE', image)
    vi.stubEnv('APPIMAGE_EXTRACT_AND_RUN', '0')
    relaunchHomeAppImage(image)
    expect(process.env.APPIMAGE_EXTRACT_AND_RUN).toBe('0')
    expect(appMock.relaunch).toHaveBeenCalledWith({ execPath: image, args: process.argv.slice(1) })
  })
})
