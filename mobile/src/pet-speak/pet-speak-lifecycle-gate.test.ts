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
import { act, create } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionState } from '../transport/types'
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

vi.mock('react-native', () => ({
  Platform: { OS: 'android', Version: 34 },
  View: 'View',
  Text: 'Text',
  StyleSheet: {
    create: (styles: unknown) => styles,
    hairlineWidth: 1
  }
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

import { RpcClientProvider } from '../transport/client-context'
import { PetSpeakRootBridge } from './pet-speak-root-bridge'
import { subscribeToPetSpeak } from './pet-speak-subscription'
import type { PetSpeechPreferences } from './pet-speech-preferences'

type FakeClient = RpcClient & {
  emitState: (state: ConnectionState) => void
}

function makeFakeClient(initialState: ConnectionState): FakeClient {
  let state = initialState
  const listeners = new Set<(state: ConnectionState) => void>()
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
  }
}

function makeProfile(id: string, name: string) {
  return {
    id,
    name,
    endpoint: `${id}.example:7443`,
    token: `token-${id}`,
    publicKeyB64: 'key-1',
    credentialStatus: 'ready',
    profile: {
      id,
      name,
      endpoint: `${id}.example:7443`,
      token: `token-${id}`,
      lastSeen: Date.now(),
      createdAt: Date.now()
    },
    lastConnected: 100
  }
}

describe('PetSpeakRootBridge Enabled Lifecycle Gate', () => {
  let prefsState: PetSpeechPreferences
  let prefsListeners: Set<(p: PetSpeechPreferences) => void>
  let acquireVoiceSessionMock: ReturnType<typeof vi.fn>
  let releaseVoiceSessionMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    prefsListeners = new Set()
    prefsState = {
      enabled: false,
      migrationCompleted: false,
      installUuid: 'uuid-1',
      rate: 1,
      voiceByLanguage: {}
    }
    acquireVoiceSessionMock = vi.fn(async () => ({ held: true }))
    releaseVoiceSessionMock = vi.fn(async () => {})
  })

  function updatePrefs(next: Partial<PetSpeechPreferences>) {
    prefsState = { ...prefsState, ...next }
    act(() => {
      for (const l of prefsListeners) {
        l({ ...prefsState })
      }
    })
  }

  it('while Disabled (Off), does NOT subscribe, acquire voice session, or hold notification', async () => {
    const clientA = makeFakeClient('connected')
    openHostLogicalClientMock.mockReturnValue(clientA)
    const entries = [makeProfile('host-1', 'Host 1')]
    loadHostCatalogMock.mockResolvedValue(entries)

    let root: { unmount: () => void }
    await act(async () => {
      root = create(
        createElement(
          RpcClientProvider,
          null,
          createElement(PetSpeakRootBridge, {
            isAndroid: true,
            loadPreferences: () => Promise.resolve(prefsState),
            subscribePreferences: (l) => {
              prefsListeners.add(l)
              return () => prefsListeners.delete(l)
            },
            acquireVoiceSession: acquireVoiceSessionMock,
            releaseVoiceSession: releaseVoiceSessionMock
          })
        )
      )
      // wait for catalog load to resolve
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(subscribeToPetSpeak).not.toHaveBeenCalled()
    expect(acquireVoiceSessionMock).not.toHaveBeenCalled()

    root.unmount()
  })

  it('Off -> On transition initializes subscription and acquires session', async () => {
    const clientA = makeFakeClient('connected')
    openHostLogicalClientMock.mockReturnValue(clientA)
    const entries = [makeProfile('host-1', 'Host 1')]
    loadHostCatalogMock.mockResolvedValue(entries)

    let root: { unmount: () => void }
    await act(async () => {
      root = create(
        createElement(
          RpcClientProvider,
          null,
          createElement(PetSpeakRootBridge, {
            isAndroid: true,
            loadPreferences: () => Promise.resolve(prefsState),
            subscribePreferences: (l) => {
              prefsListeners.add(l)
              return () => prefsListeners.delete(l)
            },
            acquireVoiceSession: acquireVoiceSessionMock,
            releaseVoiceSession: releaseVoiceSessionMock
          })
        )
      )
      // wait for catalog load to resolve
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(subscribeToPetSpeak).not.toHaveBeenCalled()

    // Flip switch to On
    await act(async () => {
      updatePrefs({ enabled: true })
      await new Promise((r) => setTimeout(r, 20))
    })

    expect(subscribeToPetSpeak).toHaveBeenCalled()
    expect(acquireVoiceSessionMock).toHaveBeenCalled()

    // Flip switch back to Off
    await act(async () => {
      updatePrefs({ enabled: false })
      await new Promise((r) => setTimeout(r, 20))
    })

    expect(releaseVoiceSessionMock).toHaveBeenCalled()

    root.unmount()
  })
})
