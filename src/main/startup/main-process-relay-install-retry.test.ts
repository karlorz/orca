import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const state: {
    isQuitting: boolean
    desktopRelayService: object | null
    desktopRelayInstaller: object | null
    initialProxyApplicationReady: Promise<void>
  } = {
    isQuitting: false,
    desktopRelayService: null,
    desktopRelayInstaller: null,
    initialProxyApplicationReady: Promise.resolve()
  }
  return {
    ensure: vi.fn<() => Promise<boolean>>(),
    retryScheduleConstructed: vi.fn(),
    state
  }
})

vi.mock('electron', () => ({
  app: { getVersion: () => '0.0.0-test' },
  powerMonitor: { on: vi.fn() }
}))
vi.mock('./main-process-state', () => ({ mainProcessState: mocks.state }))
vi.mock('./main-process-relay-status', () => ({ publishDesktopRelayStatus: vi.fn() }))
vi.mock('../orca-profiles/profile-cloud-auth-config', () => ({
  getOrcaCloudAuthConfig: () => ({ configured: false })
}))
vi.mock('../orca-profiles/profile-storage-paths', () => ({ getProfileUserDataPath: () => '/tmp' }))
vi.mock('../runtime/relay/desktop-relay-service', () => ({ DesktopRelayService: vi.fn() }))
vi.mock('../runtime/relay/desktop-relay-service-installer', () => ({
  createDesktopRelayServiceInstaller: () => ({ ensure: mocks.ensure, authChanged: vi.fn() })
}))
vi.mock('../runtime/relay/relay-retry-schedule', () => ({
  RelayRetrySchedule: vi.fn(() => {
    mocks.retryScheduleConstructed()
    return {}
  })
}))

import { startDesktopRelayService } from './main-process-relay-startup'

function runtimeRpc() {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: startup only registers the installer hook on the RPC server.
  return { setMobileRelayPairingProviderInstaller: vi.fn() } as never
}

describe('desktop relay install retry (fork 1/5/15/60s)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.ensure.mockReset()
    mocks.retryScheduleConstructed.mockReset()
    mocks.state.isQuitting = false
    mocks.state.desktopRelayService = null
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('startup retry: retries install on 1/5/15/60s, separate from connection backoff, without blocking app-ready', async () => {
    mocks.ensure.mockResolvedValue(false)
    const calledAt: number[] = []
    mocks.ensure.mockImplementation(async () => {
      calledAt.push(Date.now())
      return false
    })
    const start = Date.now()

    // App-ready continues right after registering the installer: it settles while
    // the whole retry tail (up to the 60s step) is still pending on timers.
    const appReady = (async () => {
      startDesktopRelayService(runtimeRpc())
      return 'ready'
    })()
    await expect(appReady).resolves.toBe('ready')
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    expect(mocks.ensure).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1_000 + 5_000 + 15_000 + 60_000)
    expect(calledAt.map((at) => at - start)).toEqual([0, 1_000, 6_000, 21_000, 81_000])
    // Bounded: no fifth retry, and no relay connection backoff schedule involved.
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(mocks.ensure).toHaveBeenCalledTimes(5)
    expect(mocks.retryScheduleConstructed).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stops retrying once a service is installed or the app is quitting', async () => {
    mocks.ensure.mockResolvedValueOnce(false).mockResolvedValueOnce(false)
    startDesktopRelayService(runtimeRpc())
    await vi.advanceTimersByTimeAsync(1_000)
    expect(mocks.ensure).toHaveBeenCalledTimes(2)

    mocks.state.desktopRelayService = {}
    await vi.advanceTimersByTimeAsync(5_000)
    expect(mocks.ensure).toHaveBeenCalledTimes(2)

    mocks.state.desktopRelayService = null
    mocks.ensure.mockReset().mockResolvedValue(false)
    startDesktopRelayService(runtimeRpc())
    await vi.advanceTimersByTimeAsync(0)
    mocks.state.isQuitting = true
    await vi.advanceTimersByTimeAsync(2 * 60_000)
    expect(mocks.ensure).toHaveBeenCalledTimes(1)
  })
})
