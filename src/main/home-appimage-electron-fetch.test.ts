import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installNetRequestFetchAdapter } from './updater-net-request.fixture'
import {
  resetElectronProxyCredentialsForTests,
  setElectronProxyCredentialsForSession
} from './network/electron-proxy-credentials'

const { netFetchMock, netRequestMock, defaultSession } = vi.hoisted(() => ({
  netFetchMock: vi.fn(),
  netRequestMock: vi.fn(),
  defaultSession: {
    resolveProxy: async () => 'DIRECT',
    setProxy: async () => undefined
  }
}))

vi.mock('electron', () => ({
  net: { fetch: netFetchMock, request: netRequestMock },
  session: { defaultSession }
}))

const asset = 'https://github.com/karlorz/orca/releases/download/v1.4.227-6/orca-linux.AppImage'
const storage = 'https://objects.githubusercontent.com/github-production-release-asset/1'

describe('Electron home AppImage redirect fetch', () => {
  beforeEach(() => {
    netFetchMock.mockReset()
    netRequestMock.mockReset()
    installNetRequestFetchAdapter(netRequestMock, netFetchMock)
  })

  afterEach(() => {
    resetElectronProxyCredentialsForTests()
  })

  it("reproduces Electron cancelling an unfollowed manual redirect with 'Redirect was cancelled'", async () => {
    const { net } = await import('electron')
    netFetchMock.mockResolvedValue({
      status: 302,
      headers: { location: storage }
    })
    const request = net.request({ method: 'GET', url: asset, redirect: 'manual' })
    const outcome = new Promise<unknown>((resolve, reject) => {
      request.on('response', resolve)
      request.on('error', reject)
    })
    request.end()
    await expect(outcome).rejects.toThrow('Redirect was cancelled')
    expect(netRequestMock.mock.results[0]?.value.followRedirect).not.toHaveBeenCalled()
  })

  it('follows an allowlisted GitHub 302 on the direct net.request path', async () => {
    const { fetchHomeUpdateViaElectron } = await import('./home-appimage-electron-fetch')
    netFetchMock.mockImplementation((url: string) => {
      if (url === asset) {
        return { status: 302, headers: { location: storage } }
      }
      if (url === storage) {
        return { status: 200, text: async () => 'AppImage bytes' }
      }
      return { status: 404, text: async () => 'miss' }
    })
    const response = await fetchHomeUpdateViaElectron(asset, {
      method: 'GET',
      redirect: 'manual',
      credentials: 'omit'
    })
    expect(await response.text()).toBe('AppImage bytes')
    expect(netRequestMock.mock.calls[0]?.[0]).toMatchObject({
      url: asset,
      redirect: 'manual',
      credentials: 'omit'
    })
    expect(netRequestMock.mock.results[0]?.value.followRedirect).toHaveBeenCalledOnce()
  })

  it('follows an allowlisted GitHub 302 on the authenticated proxy-login path', async () => {
    const { fetchHomeUpdateViaElectron } = await import('./home-appimage-electron-fetch')
    setElectronProxyCredentialsForSession(defaultSession, {
      host: 'proxy.test',
      port: 8080,
      username: 'user',
      password: 'secret'
    })
    netFetchMock.mockImplementation((url: string) => {
      if (url === asset) {
        return { status: 302, headers: { location: storage } }
      }
      if (url === storage) {
        return { status: 200, text: async () => 'AppImage bytes' }
      }
      return { status: 404, text: async () => 'miss' }
    })
    const response = await fetchHomeUpdateViaElectron(asset, {
      method: 'GET',
      redirect: 'manual',
      credentials: 'omit'
    })
    expect(await response.text()).toBe('AppImage bytes')
    const native = netRequestMock.mock.results[0]?.value
    let supplied: [string, string] | undefined
    native.emit(
      'login',
      { isProxy: true, host: 'proxy.test', port: 8080 },
      (username?: string, password?: string) => {
        if (username !== undefined && password !== undefined) {
          supplied = [username, password]
        }
      }
    )
    expect(supplied).toEqual(['user', 'secret'])
    expect(native.followRedirect).toHaveBeenCalledOnce()
  })

  it('refuses a foreign redirect hop without following it', async () => {
    const { fetchHomeUpdateViaElectron } = await import('./home-appimage-electron-fetch')
    netFetchMock.mockResolvedValue({
      status: 302,
      headers: { location: 'https://evil.example/steal' }
    })
    await expect(
      fetchHomeUpdateViaElectron(asset, { method: 'GET', redirect: 'manual', credentials: 'omit' })
    ).rejects.toThrow('outside the GitHub release hosts')
    expect(netRequestMock.mock.results[0]?.value.followRedirect).not.toHaveBeenCalled()
  })

  it('returns a 3xx Response from fetchWithProxyLogin instead of cancelling', async () => {
    const { fetchWithProxyLogin } = await import('./host/electron-proxy-login-fetch')
    netFetchMock.mockResolvedValue({
      status: 302,
      headers: { location: storage }
    })
    const { session } = await import('electron')
    const response = await fetchWithProxyLogin(
      new Request(asset, { redirect: 'manual', credentials: 'omit' }),
      session.defaultSession
    )
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(storage)
    expect(netRequestMock.mock.results[0]?.value.followRedirect).not.toHaveBeenCalled()
  })
})
