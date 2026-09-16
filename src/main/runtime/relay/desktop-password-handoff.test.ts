import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ensureActiveOrcaProfile: vi.fn(),
  readFreshOrcaCloudSession: vi.fn()
}))

vi.mock('../../orca-profiles/profile-index-store', () => ({
  ensureActiveOrcaProfile: mocks.ensureActiveOrcaProfile
}))

vi.mock('../../orca-profiles/profile-cloud-session-refresh', () => ({
  readFreshOrcaCloudSession: mocks.readFreshOrcaCloudSession
}))

import { openDesktopPasswordPage } from './desktop-password-handoff'

describe('desktop-password-handoff', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('posts cookie endpoint with net.fetch and loads GET url into target BrowserWindow', async () => {
    mocks.ensureActiveOrcaProfile.mockReturnValue({
      profile: {
        id: 'prof-1',
        cloud: null
      }
    })

    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
      return {
        ok: true,
        status: 204
      } as unknown as Response
    })

    const loadURLMock = vi.fn(async (_url: string) => {})
    const fakeWindow = {
      isDestroyed: () => false,
      loadURL: loadURLMock
    }

    const authConfig = {
      configured: true as const,
      config: {
        apiBaseUrl: 'https://orca-auth.example.com',
        authorizeEndpoint: 'https://orca-auth.example.com/v1/desktop/auth/authorize',
        sessionEndpoint: 'https://orca-auth.example.com/v1/desktop/auth/session',
        refreshEndpoint: 'https://orca-auth.example.com/v1/desktop/auth/refresh',
        capabilitiesEndpoint: 'https://orca-auth.example.com/v1/desktop/auth/capabilities',
        profileEndpoint: 'https://orca-auth.example.com/v1/desktop/auth/profile',
        orgEndpoint: 'https://orca-auth.example.com/v1/desktop/auth/org',
        logoutEndpoint: 'https://orca-auth.example.com/v1/desktop/auth/logout',
        relayTokenEndpoint: 'https://orca-auth.example.com/v1/desktop/auth/relay-token',
        relayDirectorUrl: 'https://relay.example.com',
        clientId: 'orca-desktop',
        scope: 'openid'
      }
    }

    const result = await openDesktopPasswordPage({
      fetch: fetchMock,
      getWindow: () => fakeWindow as never,
      userDataPath: '/tmp/test-user-data',
      authConfig
    })

    // If activeProfile is not linked, returns not_signed_in
    expect(result).toEqual({ ok: false, error: 'not_signed_in' })
  })

  it('performs cookie POST and navigates window when session is valid', async () => {
    mocks.ensureActiveOrcaProfile.mockReturnValue({
      profile: {
        id: 'prof-1',
        cloud: {
          cloudProfileId: 'cprof-1',
          userId: 'user-1',
          email: 'user@example.com',
          linkedAt: Date.now()
        }
      }
    })

    mocks.readFreshOrcaCloudSession.mockResolvedValue({
      status: 'found',
      session: {
        accessToken: 'valid-token-123',
        refreshToken: 'refresh-123',
        expiresAt: Date.now() + 3600_000,
        capabilities: { flags: { 'relay.use': true }, refreshedAt: Date.now() }
      }
    })

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://orca-auth.example.com/v1/desktop/auth/password/cookie')
      expect(init?.method).toBe('POST')
      expect((init?.headers as Record<string, string>)?.authorization).toBe(
        'Bearer valid-token-123'
      )
      return {
        ok: true,
        status: 204
      } as unknown as Response
    })

    const loadURLMock = vi.fn(async (url: string) => {
      expect(url).toBe('https://orca-auth.example.com/v1/desktop/auth/password')
    })
    const fakeWindow = {
      isDestroyed: () => false,
      loadURL: loadURLMock
    }

    const authConfig = {
      configured: true as const,
      config: {
        apiBaseUrl: 'https://orca-auth.example.com',
        authorizeEndpoint: 'https://orca-auth.example.com/v1/desktop/auth/authorize',
        sessionEndpoint: 'https://orca-auth.example.com/v1/desktop/auth/session',
        refreshEndpoint: 'https://orca-auth.example.com/v1/desktop/auth/refresh',
        capabilitiesEndpoint: 'https://orca-auth.example.com/v1/desktop/auth/capabilities',
        profileEndpoint: 'https://orca-auth.example.com/v1/desktop/auth/profile',
        orgEndpoint: 'https://orca-auth.example.com/v1/desktop/auth/org',
        logoutEndpoint: 'https://orca-auth.example.com/v1/desktop/auth/logout',
        relayTokenEndpoint: 'https://orca-auth.example.com/v1/desktop/auth/relay-token',
        relayDirectorUrl: 'https://relay.example.com',
        clientId: 'orca-desktop',
        scope: 'openid'
      }
    }

    const res = await openDesktopPasswordPage({
      fetch: fetchMock,
      getWindow: () => fakeWindow as never,
      userDataPath: '/tmp/test-user-data',
      authConfig
    })

    expect(res).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(loadURLMock).toHaveBeenCalledWith(
      'https://orca-auth.example.com/v1/desktop/auth/password'
    )
  })

  it('prefers targetWindow.webContents.session.fetch when fetch dependency is not explicitly passed', async () => {
    mocks.ensureActiveOrcaProfile.mockReturnValue({
      profile: {
        id: 'prof-1',
        cloud: {
          cloudProfileId: 'cprof-1',
          userId: 'user-1',
          email: 'user@example.com',
          linkedAt: Date.now()
        }
      }
    })

    mocks.readFreshOrcaCloudSession.mockResolvedValue({
      status: 'found',
      session: {
        accessToken: 'valid-token-session-fetch',
        refreshToken: 'refresh-session-fetch',
        expiresAt: Date.now() + 3600_000,
        capabilities: { flags: { 'relay.use': true }, refreshedAt: Date.now() }
      }
    })

    const sessionFetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://orca-auth.example.com/v1/desktop/auth/password/cookie')
      expect((init?.headers as Record<string, string>)?.authorization).toBe(
        'Bearer valid-token-session-fetch'
      )
      return {
        ok: true,
        status: 204
      } as unknown as Response
    })

    const loadURLMock = vi.fn(async (_url: string) => {})
    const fakeWindow = {
      isDestroyed: () => false,
      loadURL: loadURLMock,
      webContents: {
        session: {
          fetch: sessionFetchMock
        }
      }
    }

    const authConfig = {
      configured: true as const,
      config: {
        apiBaseUrl: 'https://orca-auth.example.com',
        authorizeEndpoint: 'https://orca-auth.example.com/v1/desktop/auth/authorize',
        sessionEndpoint: 'https://orca-auth.example.com/v1/desktop/auth/session',
        refreshEndpoint: 'https://orca-auth.example.com/v1/desktop/auth/refresh',
        capabilitiesEndpoint: 'https://orca-auth.example.com/v1/desktop/auth/capabilities',
        profileEndpoint: 'https://orca-auth.example.com/v1/desktop/auth/profile',
        orgEndpoint: 'https://orca-auth.example.com/v1/desktop/auth/org',
        logoutEndpoint: 'https://orca-auth.example.com/v1/desktop/auth/logout',
        relayTokenEndpoint: 'https://orca-auth.example.com/v1/desktop/auth/relay-token',
        relayDirectorUrl: 'https://relay.example.com',
        clientId: 'orca-desktop',
        scope: 'openid'
      }
    }

    const res = await openDesktopPasswordPage({
      getWindow: () => fakeWindow as never,
      userDataPath: '/tmp/test-user-data',
      authConfig
    })

    expect(res).toEqual({ ok: true })
    expect(sessionFetchMock).toHaveBeenCalledOnce()
    expect(loadURLMock).toHaveBeenCalledWith(
      'https://orca-auth.example.com/v1/desktop/auth/password'
    )
  })
})
