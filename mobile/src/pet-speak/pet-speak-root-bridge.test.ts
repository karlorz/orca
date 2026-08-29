vi.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 'high' },
  setNotificationChannelAsync: vi.fn(),
  getPermissionsAsync: vi.fn(),
  requestPermissionsAsync: vi.fn(),
  scheduleNotificationAsync: vi.fn(),
  dismissNotificationAsync: vi.fn()
}))

vi.mock('expo-speech', () => ({
  VoiceQuality: { Default: 'Default', Enhanced: 'Enhanced' },
  getAvailableVoicesAsync: vi.fn(async () => []),
  speak: vi.fn(),
  stop: vi.fn(async () => {})
}))

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionState, HostCatalogEntry, HostProfile } from '../transport/types'
import type { RpcClient } from '../transport/rpc-client'

const openHostLogicalClientMock = vi.fn()
const loadHostCatalogMock = vi.fn()

vi.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>()
  return {
    default: {
      getItem: vi.fn(async (key: string) => store.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => {
        store.set(key, value)
      }),
      removeItem: vi.fn(async (key: string) => {
        store.delete(key)
      }),
      getAllKeys: vi.fn(async () => Array.from(store.keys())),
      clear: vi.fn(async () => {
        store.clear()
      })
    }
  }
})

vi.mock('./pet-speech-preferences', () => ({
  loadPetSpeechPreferences: vi.fn(async () => ({
    enabled: true,
    migrationCompleted: true,
    installUuid: 'test-uuid',
    rate: 1,
    voiceByLanguage: {}
  })),
  subscribePetSpeechPreferences: vi.fn((_listener) => {
    return () => {}
  })
}))

vi.mock('react-native', () => ({
  Platform: { OS: 'ios', Version: 18 }
}))

vi.mock('../notifications/notification-permissions', () => ({
  ensureNotificationPermissions: vi.fn(async () => true)
}))

vi.mock('../transport/host-logical-client', () => ({
  openHostLogicalClient: (...args: unknown[]) => openHostLogicalClientMock(...args)
}))
vi.mock('../transport/host-store', () => ({
  loadHostCatalog: () => loadHostCatalogMock(),
  loadHosts: () => loadHostCatalogMock()
}))
vi.mock('../transport/connection-revival-triggers', () => ({
  subscribeConnectionRevivalTriggers: () => () => {}
}))

vi.mock('./pet-speak-subscription', () => ({
  subscribeToPetSpeak: vi.fn(() => vi.fn())
}))

import { RpcClientProvider, useForceReconnect } from '../transport/client-context'
import { PetSpeakRootBridge } from './pet-speak-root-bridge'
import { subscribeToPetSpeak } from './pet-speak-subscription'

type FakeClient = RpcClient & {
  emitState: (state: ConnectionState) => void
  closeMock: ReturnType<typeof vi.fn>
}

function makeFakeClient(initialState: ConnectionState): FakeClient {
  let state = initialState
  const listeners = new Set<(state: ConnectionState) => void>()
  const closeMock = vi.fn()
  return {
    sendRequest: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    updateTerminalSubscriptionViewport: vi.fn(),
    getState: () => state,
    getReconnectAttempt: () => 0,
    getLastConnectedAt: () => null,
    getActivePath: () => 'lan',
    getPendingPath: () => null,
    isPairingRejected: () => false,
    onConnectionPathChange: () => () => {},
    onStateChange: (listener: (state: ConnectionState) => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    close: () => {
      closeMock()
      state = 'disconnected'
      for (const listener of listeners) {
        listener(state)
      }
    },
    emitState: (nextState: ConnectionState) => {
      state = nextState
      for (const listener of listeners) {
        listener(nextState)
      }
    }
  } as unknown as FakeClient
}

const mockSubscribeToPetSpeak = vi.mocked(subscribeToPetSpeak)

const HOST_A: HostProfile = {
  id: 'host-a',
  name: 'Host A',
  endpoint: 'ws://127.0.0.1:6768',
  deviceToken: 'token-a',
  publicKeyB64: 'key-a',
  credentialStatus: 'valid',
  isConnectable: true,
  lastConnected: 100
}

const HOST_B: HostProfile = {
  id: 'host-b',
  name: 'Host B',
  endpoint: 'ws://127.0.0.1:6769',
  deviceToken: 'token-b',
  publicKeyB64: 'key-b',
  credentialStatus: 'valid',
  isConnectable: true,
  lastConnected: 50
}

const HOST_C: HostProfile = {
  id: 'host-c',
  name: 'Host C',
  endpoint: 'ws://127.0.0.1:6770',
  deviceToken: 'token-c',
  publicKeyB64: 'key-c',
  credentialStatus: 'valid',
  isConnectable: true,
  lastConnected: 40
}

const HOST_D: HostProfile = {
  id: 'host-d',
  name: 'Host D',
  endpoint: 'ws://127.0.0.1:6771',
  deviceToken: 'token-d',
  publicKeyB64: 'key-d',
  credentialStatus: 'valid',
  isConnectable: true,
  lastConnected: 30
}

describe('PetSpeakRootBridge', () => {
  beforeEach(() => {
    openHostLogicalClientMock.mockReset()
    loadHostCatalogMock.mockReset()
    mockSubscribeToPetSpeak.mockReset()
  })

  it('subscribes exactly once per connected host across route changes, cleans up on disconnect/replacement/removal, and avoids duplicates', async () => {
    const clientA = makeFakeClient('connected')
    const clientB = makeFakeClient('disconnected')
    const unsubs: Record<string, ReturnType<typeof vi.fn>> = {}

    openHostLogicalClientMock.mockImplementation((profile: HostProfile) => {
      if (profile.id === 'host-a') {
        return clientA
      }
      if (profile.id === 'host-b') {
        return clientB
      }
      return makeFakeClient('connected')
    })

    const catalog: HostCatalogEntry[] = [
      {
        id: HOST_A.id,
        name: HOST_A.name,
        endpoint: HOST_A.endpoint,
        publicKeyB64: HOST_A.publicKeyB64,
        credentialStatus: 'ready',
        profile: HOST_A,
        lastConnected: 100
      },
      {
        id: HOST_B.id,
        name: HOST_B.name,
        endpoint: HOST_B.endpoint,
        publicKeyB64: HOST_B.publicKeyB64,
        credentialStatus: 'ready',
        profile: HOST_B,
        lastConnected: 50
      }
    ]
    loadHostCatalogMock.mockResolvedValue(catalog)

    mockSubscribeToPetSpeak.mockImplementation((client: unknown) => {
      const unsub = vi.fn()
      const hostId = client === clientA ? 'host-a' : 'host-b'
      unsubs[hostId] = unsub
      return unsub
    })

    let forceReconnectHost: (hostId: string) => Promise<void> = async () => {}
    let triggerCatalogRefresh: () => void = () => {}

    const catalogListeners = new Set<() => void>()
    const subscribeToCatalogChange = (listener: () => void) => {
      catalogListeners.add(listener)
      return () => {
        catalogListeners.delete(listener)
      }
    }
    triggerCatalogRefresh = () => {
      for (const listener of catalogListeners) {
        listener()
      }
    }

    function InnerChild({ route }: { route: string }) {
      forceReconnectHost = useForceReconnect()
      return createElement('div', { 'data-route': route })
    }

    function Harness({ route }: { route: string }) {
      return createElement(
        RpcClientProvider,
        null,
        createElement(PetSpeakRootBridge, { subscribeToCatalogChange }),
        createElement(InnerChild, { route })
      )
    }

    let renderer: ReactTestRenderer | null = null
    await act(async () => {
      renderer = create(createElement(Harness, { route: 'Home' }))
      await Promise.resolve()
    })
    await act(async () => {
      await Promise.resolve()
    })

    // Host A is connected -> exactly 1 voice subscription
    expect(mockSubscribeToPetSpeak).toHaveBeenCalledWith(clientA, undefined, 'host-a')
    expect(mockSubscribeToPetSpeak).not.toHaveBeenCalledWith(clientB, undefined, 'host-b')
    expect(unsubs['host-a']).toBeDefined()

    // 1. Route navigation: Home -> Session -> Settings -> Home
    // Voice subscription must survive navigation without tearing down or re-subscribing
    await act(async () => {
      renderer?.update(createElement(Harness, { route: 'Session' }))
      await Promise.resolve()
    })
    expect(unsubs['host-a']).not.toHaveBeenCalled()

    await act(async () => {
      renderer?.update(createElement(Harness, { route: 'Settings' }))
      await Promise.resolve()
    })
    expect(unsubs['host-a']).not.toHaveBeenCalled()

    await act(async () => {
      renderer?.update(createElement(Harness, { route: 'Home' }))
      await Promise.resolve()
    })
    expect(unsubs['host-a']).not.toHaveBeenCalled()

    // 2. Multi-host: Host B transitions from disconnected -> connected
    await act(async () => {
      clientB.emitState('connected')
      await Promise.resolve()
    })
    expect(mockSubscribeToPetSpeak).toHaveBeenCalledTimes(2)
    expect(mockSubscribeToPetSpeak).toHaveBeenCalledWith(clientB, undefined, 'host-b')
    expect(unsubs['host-b']).toBeDefined()

    // 3. Host B disconnects -> cleans up subscription for host-b exactly once
    await act(async () => {
      clientB.emitState('disconnected')
      await Promise.resolve()
    })
    expect(unsubs['host-b']).toHaveBeenCalledTimes(1)
    expect(unsubs['host-a']).not.toHaveBeenCalled()

    // 4. Host replacement: clientA replaced via reconnect
    const clientA2 = makeFakeClient('connected')
    openHostLogicalClientMock.mockImplementation((profile: HostProfile) => {
      if (profile.id === 'host-a') {
        return clientA2
      }
      return clientB
    })
    await act(async () => {
      await forceReconnectHost('host-a')
      await Promise.resolve()
    })
    expect(unsubs['host-a']).toHaveBeenCalledTimes(1) // Old client cleaned up
    expect(mockSubscribeToPetSpeak).toHaveBeenCalledWith(clientA2, undefined, 'host-a')

    const unsubA2 = mockSubscribeToPetSpeak.mock.results[2]?.value

    // 5. Host removal: host catalog no longer contains host-a
    loadHostCatalogMock.mockResolvedValue([
      {
        id: HOST_B.id,
        name: HOST_B.name,
        endpoint: HOST_B.endpoint,
        publicKeyB64: HOST_B.publicKeyB64,
        credentialStatus: 'ready',
        profile: HOST_B,
        lastConnected: 50
      }
    ])
    await act(async () => {
      triggerCatalogRefresh()
      await Promise.resolve()
      await Promise.resolve()
    })

    // Assert A's subscription is cleaned up exactly once on removal before unmount
    expect(unsubA2).toHaveBeenCalledTimes(1)

    // 6. Root unmount -> unmount cleans up remaining active host B, and does NOT call A again
    await act(async () => {
      renderer?.unmount()
    })
    expect(unsubA2).toHaveBeenCalledTimes(1)
    expect(unsubs['host-b']).toHaveBeenCalledTimes(1)
  })

  it('primes, acquires, and subscribes to all 4+ connectable hosts without capping at 3', async () => {
    const clientA = makeFakeClient('connected')
    const clientB = makeFakeClient('connected')
    const clientC = makeFakeClient('connected')
    const clientD = makeFakeClient('connected')

    openHostLogicalClientMock.mockImplementation((profile: HostProfile) => {
      switch (profile.id) {
        case 'host-a':
          return clientA
        case 'host-b':
          return clientB
        case 'host-c':
          return clientC
        case 'host-d':
          return clientD
        default:
          return makeFakeClient('connected')
      }
    })

    const catalog: HostCatalogEntry[] = [
      {
        id: HOST_A.id,
        name: HOST_A.name,
        endpoint: HOST_A.endpoint,
        publicKeyB64: HOST_A.publicKeyB64,
        credentialStatus: 'ready',
        profile: HOST_A,
        lastConnected: 100
      },
      {
        id: HOST_B.id,
        name: HOST_B.name,
        endpoint: HOST_B.endpoint,
        publicKeyB64: HOST_B.publicKeyB64,
        credentialStatus: 'ready',
        profile: HOST_B,
        lastConnected: 50
      },
      {
        id: HOST_C.id,
        name: HOST_C.name,
        endpoint: HOST_C.endpoint,
        publicKeyB64: HOST_C.publicKeyB64,
        credentialStatus: 'ready',
        profile: HOST_C,
        lastConnected: 40
      },
      {
        id: HOST_D.id,
        name: HOST_D.name,
        endpoint: HOST_D.endpoint,
        publicKeyB64: HOST_D.publicKeyB64,
        credentialStatus: 'ready',
        profile: HOST_D,
        lastConnected: 30
      }
    ]
    loadHostCatalogMock.mockResolvedValue(catalog)

    let renderer: ReactTestRenderer | null = null
    await act(async () => {
      renderer = create(createElement(RpcClientProvider, null, createElement(PetSpeakRootBridge)))
      await Promise.resolve()
    })
    await act(async () => {
      await Promise.resolve()
    })

    // All 4 hosts must be subscribed to pet.speak
    expect(mockSubscribeToPetSpeak).toHaveBeenCalledWith(clientA, undefined, 'host-a')
    expect(mockSubscribeToPetSpeak).toHaveBeenCalledWith(clientB, undefined, 'host-b')
    expect(mockSubscribeToPetSpeak).toHaveBeenCalledWith(clientC, undefined, 'host-c')
    expect(mockSubscribeToPetSpeak).toHaveBeenCalledWith(clientD, undefined, 'host-d')
    expect(mockSubscribeToPetSpeak).toHaveBeenCalledTimes(4)

    await act(async () => {
      renderer?.unmount()
    })
  })

  it('protects against catalog load race and cleans up removed host without resurrection by stale loads', async () => {
    const clientA = makeFakeClient('connected')
    const clientB = makeFakeClient('connected')

    openHostLogicalClientMock.mockImplementation((profile: HostProfile) => {
      if (profile.id === 'host-a') {
        return clientA
      }
      return clientB
    })

    let unsubA = vi.fn()
    let unsubB = vi.fn()
    mockSubscribeToPetSpeak.mockImplementation((client: unknown) => {
      if (client === clientA) {
        unsubA = vi.fn()
        return unsubA
      }
      unsubB = vi.fn()
      return unsubB
    })

    const catalogListeners = new Set<() => void>()
    const subscribeToCatalogChange = (listener: () => void) => {
      catalogListeners.add(listener)
      return () => {
        catalogListeners.delete(listener)
      }
    }
    const triggerCatalogRefresh = () => {
      for (const listener of catalogListeners) {
        listener()
      }
    }

    let resolveFirstLoad: (val: HostCatalogEntry[]) => void = () => {}
    const firstLoadPromise = new Promise<HostCatalogEntry[]>((resolve) => {
      resolveFirstLoad = resolve
    })

    // Initial catalog: both host-a and host-b
    const initialCatalog: HostCatalogEntry[] = [
      {
        id: HOST_A.id,
        name: HOST_A.name,
        endpoint: HOST_A.endpoint,
        publicKeyB64: HOST_A.publicKeyB64,
        credentialStatus: 'ready',
        profile: HOST_A,
        lastConnected: 100
      },
      {
        id: HOST_B.id,
        name: HOST_B.name,
        endpoint: HOST_B.endpoint,
        publicKeyB64: HOST_B.publicKeyB64,
        credentialStatus: 'ready',
        profile: HOST_B,
        lastConnected: 50
      }
    ]
    loadHostCatalogMock.mockResolvedValueOnce(initialCatalog)

    let renderer: ReactTestRenderer | null = null
    await act(async () => {
      renderer = create(
        createElement(
          RpcClientProvider,
          null,
          createElement(PetSpeakRootBridge, { subscribeToCatalogChange })
        )
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    // Both A and B initially connected and subscribed
    expect(mockSubscribeToPetSpeak).toHaveBeenCalledWith(clientA, undefined, 'host-a')
    expect(mockSubscribeToPetSpeak).toHaveBeenCalledWith(clientB, undefined, 'host-b')
    expect(mockSubscribeToPetSpeak).toHaveBeenCalledTimes(2)

    // Now trigger load 1 (slow, returns A+B)
    loadHostCatalogMock.mockImplementationOnce(() => firstLoadPromise)
    act(() => {
      triggerCatalogRefresh()
    })

    // While load 1 is still pending, trigger load 2 (fast, returns only B)
    const fastCatalog: HostCatalogEntry[] = [
      {
        id: HOST_B.id,
        name: HOST_B.name,
        endpoint: HOST_B.endpoint,
        publicKeyB64: HOST_B.publicKeyB64,
        credentialStatus: 'ready',
        profile: HOST_B,
        lastConnected: 50
      }
    ]
    loadHostCatalogMock.mockResolvedValueOnce(fastCatalog)
    await act(async () => {
      triggerCatalogRefresh()
      await Promise.resolve()
      await Promise.resolve()
    })

    // Host A must be cleaned up once on removal, B remains active
    expect(unsubA).toHaveBeenCalledTimes(1)
    expect(unsubB).not.toHaveBeenCalled()

    // Now resolve load 1 (stale, had [host-a, host-b])
    await act(async () => {
      resolveFirstLoad(initialCatalog)
      await Promise.resolve()
      await Promise.resolve()
    })

    // Stale load 1 MUST NOT resurrect or re-subscribe host-a
    expect(mockSubscribeToPetSpeak).toHaveBeenCalledTimes(2)
    expect(unsubA).toHaveBeenCalledTimes(1)

    // Late load resolving after unmount must not cause any errors or state updates
    let resolveLateLoad: (val: HostCatalogEntry[]) => void = () => {}
    const lateLoadPromise = new Promise<HostCatalogEntry[]>((resolve) => {
      resolveLateLoad = resolve
    })
    loadHostCatalogMock.mockImplementationOnce(() => lateLoadPromise)
    act(() => {
      triggerCatalogRefresh()
    })

    await act(async () => {
      renderer?.unmount()
    })

    // Resolve after unmount
    await act(async () => {
      resolveLateLoad(initialCatalog)
      await Promise.resolve()
    })
  })

  describe('connected voice session FGS lifecycle', () => {
    it('acquires session once on Android when first connected host appears and notification permission is granted', async () => {
      const clientA = makeFakeClient('disconnected')
      openHostLogicalClientMock.mockReturnValue(clientA)

      loadHostCatalogMock.mockResolvedValue([
        {
          id: HOST_A.id,
          name: HOST_A.name,
          endpoint: HOST_A.endpoint,
          publicKeyB64: HOST_A.publicKeyB64,
          credentialStatus: 'ready',
          profile: HOST_A,
          lastConnected: 100
        }
      ])

      const ensurePermissionsMock = vi.fn().mockResolvedValue(true)
      const acquireSessionMock = vi.fn().mockResolvedValue({ held: true })
      const releaseSessionMock = vi.fn().mockResolvedValue(undefined)

      let renderer: ReactTestRenderer | null = null
      await act(async () => {
        renderer = create(
          createElement(
            RpcClientProvider,
            null,
            createElement(PetSpeakRootBridge, {
              isAndroid: true,
              ensureNotificationPermissions: ensurePermissionsMock,
              acquireVoiceSession: acquireSessionMock,
              releaseVoiceSession: releaseSessionMock
            })
          )
        )
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(ensurePermissionsMock).not.toHaveBeenCalled()
      expect(acquireSessionMock).not.toHaveBeenCalled()

      // Host A connects
      await act(async () => {
        clientA.emitState('connected')
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(ensurePermissionsMock).toHaveBeenCalledTimes(1)
      expect(acquireSessionMock).toHaveBeenCalledTimes(1)

      // Unmount releases session
      await act(async () => {
        renderer?.unmount()
        await Promise.resolve()
      })

      expect(releaseSessionMock).toHaveBeenCalledTimes(1)
    })

    it('does not acquire voice session when notification permission is denied', async () => {
      const clientA = makeFakeClient('disconnected')
      openHostLogicalClientMock.mockReturnValue(clientA)

      loadHostCatalogMock.mockResolvedValue([
        {
          id: HOST_A.id,
          name: HOST_A.name,
          endpoint: HOST_A.endpoint,
          publicKeyB64: HOST_A.publicKeyB64,
          credentialStatus: 'ready',
          profile: HOST_A,
          lastConnected: 100
        }
      ])

      const ensurePermissionsMock = vi.fn().mockResolvedValue(false)
      const acquireSessionMock = vi.fn().mockResolvedValue({ held: false })
      const releaseSessionMock = vi.fn().mockResolvedValue(undefined)

      let renderer: ReactTestRenderer | null = null
      await act(async () => {
        renderer = create(
          createElement(
            RpcClientProvider,
            null,
            createElement(PetSpeakRootBridge, {
              isAndroid: true,
              ensureNotificationPermissions: ensurePermissionsMock,
              acquireVoiceSession: acquireSessionMock,
              releaseVoiceSession: releaseSessionMock
            })
          )
        )
        await Promise.resolve()
        await Promise.resolve()
      })

      await act(async () => {
        clientA.emitState('connected')
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(ensurePermissionsMock).toHaveBeenCalledTimes(1)
      expect(acquireSessionMock).not.toHaveBeenCalled()

      await act(async () => {
        renderer?.unmount()
        await Promise.resolve()
      })
      expect(releaseSessionMock).not.toHaveBeenCalled()
    })

    it('second connected host does not double-acquire, and last disconnect releases once', async () => {
      const clientA = makeFakeClient('disconnected')
      const clientB = makeFakeClient('disconnected')

      openHostLogicalClientMock.mockImplementation((profile: HostProfile) => {
        if (profile.id === 'host-a') {
          return clientA
        }
        return clientB
      })

      loadHostCatalogMock.mockResolvedValue([
        {
          id: HOST_A.id,
          name: HOST_A.name,
          endpoint: HOST_A.endpoint,
          publicKeyB64: HOST_A.publicKeyB64,
          credentialStatus: 'ready',
          profile: HOST_A,
          lastConnected: 100
        },
        {
          id: HOST_B.id,
          name: HOST_B.name,
          endpoint: HOST_B.endpoint,
          publicKeyB64: HOST_B.publicKeyB64,
          credentialStatus: 'ready',
          profile: HOST_B,
          lastConnected: 50
        }
      ])

      const ensurePermissionsMock = vi.fn().mockResolvedValue(true)
      const acquireSessionMock = vi.fn().mockResolvedValue({ held: true })
      const releaseSessionMock = vi.fn().mockResolvedValue(undefined)

      let renderer: ReactTestRenderer | null = null
      await act(async () => {
        renderer = create(
          createElement(
            RpcClientProvider,
            null,
            createElement(PetSpeakRootBridge, {
              isAndroid: true,
              ensureNotificationPermissions: ensurePermissionsMock,
              acquireVoiceSession: acquireSessionMock,
              releaseVoiceSession: releaseSessionMock
            })
          )
        )
        await Promise.resolve()
        await Promise.resolve()
      })

      // Host A connects -> acquires session
      await act(async () => {
        clientA.emitState('connected')
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(acquireSessionMock).toHaveBeenCalledTimes(1)

      // Host B connects -> no second acquire
      await act(async () => {
        clientB.emitState('connected')
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(acquireSessionMock).toHaveBeenCalledTimes(1)

      // Host A disconnects -> session still held by Host B
      await act(async () => {
        clientA.emitState('disconnected')
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(releaseSessionMock).not.toHaveBeenCalled()

      // Host B disconnects -> session released
      await act(async () => {
        clientB.emitState('disconnected')
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(releaseSessionMock).toHaveBeenCalledTimes(1)

      await act(async () => {
        renderer?.unmount()
        await Promise.resolve()
      })
      // No double release on unmount if already released
      expect(releaseSessionMock).toHaveBeenCalledTimes(1)
    })
  })
})
