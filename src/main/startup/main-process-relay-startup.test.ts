import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { OrcaRuntimeRpcServer } from '../runtime/runtime-rpc'
import type {
  MobilePairingConnectionContext,
  MobileRelayPairingProvider
} from '../runtime/runtime-rpc/runtime-rpc-pairing-types'

type E2EEKeypairStub = {
  publicKey: Uint8Array
  secretKey: Uint8Array
  publicKeyB64: string
}

type RelayStartupFakes = {
  configured: boolean
  keypair: E2EEKeypairStub | null
  wiring: object | null
  construct: Mock
  start: Mock
  ensureLive: Mock
  authMutated: Mock
  demandStateChanged: Mock
  getEndpoints: Mock
  createPairingRelay: Mock
  provisionRelay: Mock
  onDeviceRevokeQueued: Mock
  powerOn: Mock
  powerOff: Mock
}

type RelayRuntimeStub = {
  provider: MobileRelayPairingProvider | null
  getE2EEKeypair: () => E2EEKeypairStub | null
  getMobileSocketWiring: () => object | null
  setMobileRelayPairingProvider: (provider: MobileRelayPairingProvider | null) => void
}

const READY_KEYPAIR: E2EEKeypairStub = {
  publicKey: new Uint8Array(32),
  secretKey: new Uint8Array(32),
  publicKeyB64: 'k'
}

const READY_WIRING = { attachTransport: () => () => {} }

const PAIRING_CONTEXT: MobilePairingConnectionContext = {
  deviceId: 'device-1',
  connectionId: 'conn-1',
  transport: { transport: 'direct' }
}

const fakes = vi.hoisted((): RelayStartupFakes => ({
  configured: true,
  keypair: null,
  wiring: null,
  construct: vi.fn(),
  start: vi.fn(),
  ensureLive: vi.fn(),
  authMutated: vi.fn(),
  demandStateChanged: vi.fn(),
  getEndpoints: vi.fn(),
  createPairingRelay: vi.fn(),
  provisionRelay: vi.fn(),
  onDeviceRevokeQueued: vi.fn(),
  powerOn: vi.fn(),
  powerOff: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getVersion: () => '1.4.205-1' },
  powerMonitor: {
    on: (...args: unknown[]) => fakes.powerOn(...args),
    off: (...args: unknown[]) => fakes.powerOff(...args)
  }
}))

vi.mock('../orca-profiles/profile-cloud-auth-config', () => ({
  getOrcaCloudAuthConfig: () =>
    fakes.configured
      ? { configured: true as const, config: { relayDirectorUrl: 'https://relay.test' } }
      : { configured: false as const, setupMessage: 'unset' }
}))

vi.mock('../orca-profiles/profile-storage-paths', () => ({
  getProfileUserDataPath: () => '/tmp/orca-relay-startup-test'
}))

vi.mock('../runtime/relay/desktop-relay-service', () => ({
  DesktopRelayService: class {
    start = fakes.start
    ensureLive = fakes.ensureLive
    authMutated = fakes.authMutated
    demandStateChanged = fakes.demandStateChanged
    getEndpoints = fakes.getEndpoints
    createPairingRelay = fakes.createPairingRelay
    provisionRelay = fakes.provisionRelay
    onDeviceRevokeQueued = fakes.onDeviceRevokeQueued
    constructor() {
      fakes.construct()
    }
  }
}))

import { mainProcessState as state } from './main-process-state'
import {
  installDesktopRelayService,
  notifyDesktopRelayAuthMutated,
  stopDesktopRelayStartup
} from './main-process-relay-startup'

function asRuntimeRpc(rpc: RelayRuntimeStub): OrcaRuntimeRpcServer {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: stub implements getE2EEKeypair, getMobileSocketWiring, and setMobileRelayPairingProvider, the only members this module reads; DesktopRelayService is mocked.
  return rpc as unknown as OrcaRuntimeRpcServer
}

function runtimeRpc(): RelayRuntimeStub {
  const server: RelayRuntimeStub = {
    provider: null,
    getE2EEKeypair: () => fakes.keypair,
    getMobileSocketWiring: () => fakes.wiring,
    setMobileRelayPairingProvider: (provider) => {
      server.provider = provider
    }
  }
  return server
}

function requireProvider(rpc: RelayRuntimeStub): MobileRelayPairingProvider {
  const provider = rpc.provider
  if (!provider) {
    throw new Error('expected pairing provider')
  }
  return provider
}

function requireResumeHandler(): () => void {
  const handler = fakes.powerOn.mock.calls[0]?.[1]
  if (typeof handler !== 'function') {
    throw new Error('expected powerMonitor resume handler')
  }
  return handler
}

describe('installDesktopRelayService', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    fakes.configured = true
    fakes.keypair = READY_KEYPAIR
    fakes.wiring = READY_WIRING
    fakes.construct.mockReset()
    fakes.start.mockReset()
    fakes.ensureLive.mockReset()
    fakes.authMutated.mockReset()
    fakes.demandStateChanged.mockReset()
    fakes.getEndpoints.mockReset().mockResolvedValue({ v: 1, relay: null })
    fakes.createPairingRelay.mockReset()
    fakes.provisionRelay.mockReset()
    fakes.onDeviceRevokeQueued.mockReset()
    fakes.powerOn.mockReset()
    fakes.powerOff.mockReset()
    state.desktopRelayService = null
    state.isQuitting = false
  })

  afterEach(() => {
    stopDesktopRelayStartup()
    state.desktopRelayService = null
    state.isQuitting = false
    vi.useRealTimers()
  })

  it('starts immediately when the mobile runtime is ready', () => {
    const rpc = runtimeRpc()
    installDesktopRelayService(asRuntimeRpc(rpc))
    expect(fakes.construct).toHaveBeenCalledOnce()
    expect(fakes.start).toHaveBeenCalledOnce()
    expect(state.desktopRelayService).toBeTruthy()
    expect(rpc.provider).toBeTruthy()
    expect(fakes.powerOn).toHaveBeenCalledWith('resume', expect.any(Function))
  })

  it('does not install when cloud auth is unconfigured', () => {
    fakes.configured = false
    const rpc = runtimeRpc()
    installDesktopRelayService(asRuntimeRpc(rpc))
    expect(fakes.construct).not.toHaveBeenCalled()
    expect(rpc.provider).toBeNull()
  })

  it('retries attach after wiring appears, without a second construct', async () => {
    fakes.wiring = null
    const rpc = runtimeRpc()
    installDesktopRelayService(asRuntimeRpc(rpc))
    expect(fakes.construct).not.toHaveBeenCalled()
    const provider = requireProvider(rpc)
    await expect(provider.getEndpoints(PAIRING_CONTEXT, {})).rejects.toThrow(
      'pairing_context_unavailable'
    )

    fakes.wiring = READY_WIRING
    await expect(provider.getEndpoints(PAIRING_CONTEXT, {})).resolves.toEqual({
      v: 1,
      relay: null
    })
    expect(fakes.construct).toHaveBeenCalledOnce()
    expect(fakes.getEndpoints).toHaveBeenCalledOnce()

    await provider.getEndpoints(PAIRING_CONTEXT, {})
    expect(fakes.construct).toHaveBeenCalledOnce()
  })

  it('attaches on the delayed retry when launch missed wiring', () => {
    fakes.wiring = null
    const rpc = runtimeRpc()
    installDesktopRelayService(asRuntimeRpc(rpc))
    fakes.wiring = READY_WIRING
    vi.advanceTimersByTime(1_000)
    expect(fakes.construct).toHaveBeenCalledOnce()
    expect(fakes.start).toHaveBeenCalledOnce()
  })

  it('wakes a live broker on resume and auth mutation', () => {
    const rpc = runtimeRpc()
    const runtime = asRuntimeRpc(rpc)
    installDesktopRelayService(runtime)
    requireResumeHandler()()
    expect(fakes.ensureLive).toHaveBeenCalledOnce()
    notifyDesktopRelayAuthMutated(runtime)
    expect(fakes.authMutated).toHaveBeenCalledOnce()
  })

  it('constructs from auth mutation when launch missed wiring', () => {
    fakes.wiring = null
    const rpc = runtimeRpc()
    const runtime = asRuntimeRpc(rpc)
    installDesktopRelayService(runtime)
    fakes.wiring = READY_WIRING
    notifyDesktopRelayAuthMutated(runtime)
    expect(fakes.construct).toHaveBeenCalledOnce()
    expect(fakes.authMutated).toHaveBeenCalledOnce()
  })

  it('skips construct while quitting', () => {
    fakes.wiring = null
    const rpc = runtimeRpc()
    installDesktopRelayService(asRuntimeRpc(rpc))
    state.isQuitting = true
    fakes.wiring = READY_WIRING
    vi.advanceTimersByTime(1_000)
    expect(fakes.construct).not.toHaveBeenCalled()
  })
})
