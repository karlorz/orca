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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  PET_SPEECH_STORAGE_KEYS: {
    ENABLED: 'orca:petSpeech:enabled',
    MIGRATION_COMPLETED: 'orca:petSpeech:migrationCompleted',
    INSTALL_UUID: 'orca:petSpeech:installUuid',
    RATE: 'orca:petSpeech:rate',
    VOICE_BY_LANGUAGE: 'orca:petSpeech:voiceByLanguage',
    CAPTIONS_ENABLED: 'orca:petSpeech:captionsEnabled',
    CAPTION_OFFSET: 'orca:petSpeech:captionOffset'
  },
  loadPetSpeechPreferences: vi.fn(async () => ({
    enabled: true,
    migrationCompleted: true,
    installUuid: 'test-uuid',
    rate: 1,
    captionsEnabled: false,
    captionOffset: { x: 0, y: 0 },
    voiceByLanguage: {}
  })),
  subscribePetSpeechPreferences: vi.fn((_listener) => {
    return () => {}
  }),
  setPetSpeechCaptionsEnabled: vi.fn(async () => {}),
  setPetSpeechCaptionOffset: vi.fn(async () => {})
}))

vi.mock('react-native', () => ({
  Platform: { OS: 'ios', Version: 18 },
  View: 'View',
  Text: 'Text',
  Pressable: 'Pressable',
  StyleSheet: {
    create: (styles: unknown) => styles,
    hairlineWidth: 1
  },
  PanResponder: {
    create: () => ({ panHandlers: {} })
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
  } as unknown as FakeClient
}

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

function hostCatalogEntry(profile: HostProfile): HostCatalogEntry {
  return {
    id: profile.id,
    name: profile.name,
    endpoint: profile.endpoint,
    publicKeyB64: profile.publicKeyB64,
    credentialStatus: 'ready',
    profile,
    lastConnected: profile.lastConnected
  }
}

describe('PetSpeakRootBridge reconnect hysteresis', () => {
  beforeEach(() => {
    openHostLogicalClientMock.mockReset()
    loadHostCatalogMock.mockReset()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not release voice session on reconnecting blip and updates notification to Reconnecting...', async () => {
    const clientA = makeFakeClient('connected')
    openHostLogicalClientMock.mockReturnValue(clientA)
    loadHostCatalogMock.mockResolvedValue([hostCatalogEntry(HOST_A)])

    const ensurePermissionsMock = vi.fn().mockResolvedValue(true)
    const acquireSessionMock = vi.fn().mockResolvedValue({ held: true })
    const releaseSessionMock = vi.fn().mockResolvedValue(undefined)
    const updateNotificationMock = vi.fn().mockResolvedValue(undefined)

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
            releaseVoiceSession: releaseSessionMock,
            updateVoiceSessionNotification: updateNotificationMock
          })
        )
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(acquireSessionMock).toHaveBeenCalledTimes(1)
    expect(releaseSessionMock).not.toHaveBeenCalled()

    await act(async () => {
      clientA.emitState('reconnecting')
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(releaseSessionMock).not.toHaveBeenCalled()
    expect(updateNotificationMock).toHaveBeenCalledWith('Orca Pet — Reconnecting...')

    await act(async () => {
      vi.advanceTimersByTime(2 * 60 * 1000)
      await Promise.resolve()
    })
    expect(releaseSessionMock).not.toHaveBeenCalled()

    await act(async () => {
      clientA.emitState('connected')
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(updateNotificationMock).toHaveBeenCalledWith('Pet voice connected')
    expect(releaseSessionMock).not.toHaveBeenCalled()

    await act(async () => {
      renderer?.unmount()
      await Promise.resolve()
    })
    expect(releaseSessionMock).toHaveBeenCalledTimes(1)
  })

  it('releases voice session after 5-minute grace expiry if reconnecting persists without connecting', async () => {
    const clientA = makeFakeClient('connected')
    openHostLogicalClientMock.mockReturnValue(clientA)
    loadHostCatalogMock.mockResolvedValue([hostCatalogEntry(HOST_A)])

    const ensurePermissionsMock = vi.fn().mockResolvedValue(true)
    const acquireSessionMock = vi.fn().mockResolvedValue({ held: true })
    const releaseSessionMock = vi.fn().mockResolvedValue(undefined)
    const updateNotificationMock = vi.fn().mockResolvedValue(undefined)

    await act(async () => {
      create(
        createElement(
          RpcClientProvider,
          null,
          createElement(PetSpeakRootBridge, {
            isAndroid: true,
            ensureNotificationPermissions: ensurePermissionsMock,
            acquireVoiceSession: acquireSessionMock,
            releaseVoiceSession: releaseSessionMock,
            updateVoiceSessionNotification: updateNotificationMock
          })
        )
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(acquireSessionMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      clientA.emitState('reconnecting')
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(releaseSessionMock).not.toHaveBeenCalled()
    expect(updateNotificationMock).toHaveBeenCalledWith('Orca Pet — Reconnecting...')

    await act(async () => {
      vi.advanceTimersByTime(5 * 60 * 1000)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(releaseSessionMock).toHaveBeenCalledTimes(1)
  })

  it('releases immediately when host is removed from catalog while reconnecting', async () => {
    const clientA = makeFakeClient('connected')
    openHostLogicalClientMock.mockReturnValue(clientA)

    const catalogListeners = new Set<() => void>()
    const subscribeToCatalogChange = (listener: () => void) => {
      catalogListeners.add(listener)
      return () => {
        catalogListeners.delete(listener)
      }
    }

    loadHostCatalogMock.mockResolvedValue([hostCatalogEntry(HOST_A)])

    const ensurePermissionsMock = vi.fn().mockResolvedValue(true)
    const acquireSessionMock = vi.fn().mockResolvedValue({ held: true })
    const releaseSessionMock = vi.fn().mockResolvedValue(undefined)
    const updateNotificationMock = vi.fn().mockResolvedValue(undefined)

    await act(async () => {
      create(
        createElement(
          RpcClientProvider,
          null,
          createElement(PetSpeakRootBridge, {
            isAndroid: true,
            subscribeToCatalogChange,
            ensureNotificationPermissions: ensurePermissionsMock,
            acquireVoiceSession: acquireSessionMock,
            releaseVoiceSession: releaseSessionMock,
            updateVoiceSessionNotification: updateNotificationMock
          })
        )
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      clientA.emitState('reconnecting')
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(releaseSessionMock).not.toHaveBeenCalled()

    loadHostCatalogMock.mockResolvedValue([])
    await act(async () => {
      for (const listener of catalogListeners) {
        listener()
      }
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(releaseSessionMock).toHaveBeenCalledTimes(1)
  })

  it('holds voice session and keeps reconnecting notification through reconnecting -> connecting -> handshaking oscillation', async () => {
    const clientA = makeFakeClient('connected')
    openHostLogicalClientMock.mockReturnValue(clientA)
    loadHostCatalogMock.mockResolvedValue([hostCatalogEntry(HOST_A)])

    const ensurePermissionsMock = vi.fn().mockResolvedValue(true)
    const acquireSessionMock = vi.fn().mockResolvedValue({ held: true })
    const releaseSessionMock = vi.fn().mockResolvedValue(undefined)
    const updateNotificationMock = vi.fn().mockResolvedValue(undefined)

    await act(async () => {
      create(
        createElement(
          RpcClientProvider,
          null,
          createElement(PetSpeakRootBridge, {
            isAndroid: true,
            ensureNotificationPermissions: ensurePermissionsMock,
            acquireVoiceSession: acquireSessionMock,
            releaseVoiceSession: releaseSessionMock,
            updateVoiceSessionNotification: updateNotificationMock
          })
        )
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(acquireSessionMock).toHaveBeenCalledTimes(1)

    // Socket drops -> reconnecting
    await act(async () => {
      clientA.emitState('reconnecting')
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(releaseSessionMock).not.toHaveBeenCalled()
    expect(updateNotificationMock).toHaveBeenCalledWith('Orca Pet — Reconnecting...')

    // First redial fires -> connecting
    await act(async () => {
      clientA.emitState('connecting')
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(releaseSessionMock).not.toHaveBeenCalled()

    // TLS/handshake phase -> handshaking
    await act(async () => {
      clientA.emitState('handshaking')
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(releaseSessionMock).not.toHaveBeenCalled()

    // Handshake fails / dial fails -> reconnecting again
    await act(async () => {
      clientA.emitState('reconnecting')
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(releaseSessionMock).not.toHaveBeenCalled()

    // Recovers after 2 minutes of oscillation
    await act(async () => {
      vi.advanceTimersByTime(2 * 60 * 1000)
      clientA.emitState('connected')
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(updateNotificationMock).toHaveBeenCalledWith('Pet voice connected')
    expect(releaseSessionMock).not.toHaveBeenCalled()
  })

  it('anchors grace clock at the first loss of connected so oscillation does not reset or extend grace', async () => {
    const clientA = makeFakeClient('connected')
    openHostLogicalClientMock.mockReturnValue(clientA)
    loadHostCatalogMock.mockResolvedValue([hostCatalogEntry(HOST_A)])

    const ensurePermissionsMock = vi.fn().mockResolvedValue(true)
    const acquireSessionMock = vi.fn().mockResolvedValue({ held: true })
    const releaseSessionMock = vi.fn().mockResolvedValue(undefined)
    const updateNotificationMock = vi.fn().mockResolvedValue(undefined)

    await act(async () => {
      create(
        createElement(
          RpcClientProvider,
          null,
          createElement(PetSpeakRootBridge, {
            isAndroid: true,
            ensureNotificationPermissions: ensurePermissionsMock,
            acquireVoiceSession: acquireSessionMock,
            releaseVoiceSession: releaseSessionMock,
            updateVoiceSessionNotification: updateNotificationMock
          })
        )
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    // T = 0: loss of connection
    await act(async () => {
      clientA.emitState('reconnecting')
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(releaseSessionMock).not.toHaveBeenCalled()

    // T = 2 min: redial to connecting
    await act(async () => {
      vi.advanceTimersByTime(2 * 60 * 1000)
      clientA.emitState('connecting')
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(releaseSessionMock).not.toHaveBeenCalled()

    // T = 4 min: oscillates to handshaking then reconnecting
    await act(async () => {
      vi.advanceTimersByTime(2 * 60 * 1000)
      clientA.emitState('handshaking')
      await Promise.resolve()
      clientA.emitState('reconnecting')
      await Promise.resolve()
    })
    expect(releaseSessionMock).not.toHaveBeenCalled()

    // T = 5 min (1 more minute, 5 min total from T=0): grace should expire and release
    await act(async () => {
      vi.advanceTimersByTime(1 * 60 * 1000)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(releaseSessionMock).toHaveBeenCalledTimes(1)
  })

  it('releases immediately when host transitions to auth-failed', async () => {
    const clientA = makeFakeClient('connected')
    openHostLogicalClientMock.mockReturnValue(clientA)
    loadHostCatalogMock.mockResolvedValue([hostCatalogEntry(HOST_A)])

    const ensurePermissionsMock = vi.fn().mockResolvedValue(true)
    const acquireSessionMock = vi.fn().mockResolvedValue({ held: true })
    const releaseSessionMock = vi.fn().mockResolvedValue(undefined)
    const updateNotificationMock = vi.fn().mockResolvedValue(undefined)

    await act(async () => {
      create(
        createElement(
          RpcClientProvider,
          null,
          createElement(PetSpeakRootBridge, {
            isAndroid: true,
            ensureNotificationPermissions: ensurePermissionsMock,
            acquireVoiceSession: acquireSessionMock,
            releaseVoiceSession: releaseSessionMock,
            updateVoiceSessionNotification: updateNotificationMock
          })
        )
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      clientA.emitState('auth-failed')
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(releaseSessionMock).toHaveBeenCalledTimes(1)
  })

  it('releases immediately when reconnecting host becomes disconnected', async () => {
    const clientA = makeFakeClient('connected')
    openHostLogicalClientMock.mockReturnValue(clientA)
    loadHostCatalogMock.mockResolvedValue([hostCatalogEntry(HOST_A)])

    const ensurePermissionsMock = vi.fn().mockResolvedValue(true)
    const acquireSessionMock = vi.fn().mockResolvedValue({ held: true })
    const releaseSessionMock = vi.fn().mockResolvedValue(undefined)
    const updateNotificationMock = vi.fn().mockResolvedValue(undefined)

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
            releaseVoiceSession: releaseSessionMock,
            updateVoiceSessionNotification: updateNotificationMock
          })
        )
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      clientA.emitState('reconnecting')
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(releaseSessionMock).not.toHaveBeenCalled()

    await act(async () => {
      clientA.emitState('disconnected')
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(releaseSessionMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      renderer?.unmount()
      await Promise.resolve()
    })
    expect(releaseSessionMock).toHaveBeenCalledTimes(1)
  })

  it('does not release when reconnecting arrives before acquireVoiceSession resolves', async () => {
    const clientA = makeFakeClient('disconnected')
    openHostLogicalClientMock.mockReturnValue(clientA)
    loadHostCatalogMock.mockResolvedValue([hostCatalogEntry(HOST_A)])

    const ensurePermissionsMock = vi.fn().mockResolvedValue(true)
    let resolveAcquire: (value: { held: boolean }) => void = () => {}
    const acquireSessionMock = vi.fn().mockImplementation(
      () =>
        new Promise<{ held: boolean }>((resolve) => {
          resolveAcquire = resolve
        })
    )
    const releaseSessionMock = vi.fn().mockResolvedValue(undefined)
    const updateNotificationMock = vi.fn().mockResolvedValue(undefined)

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
            releaseVoiceSession: releaseSessionMock,
            updateVoiceSessionNotification: updateNotificationMock
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

    expect(acquireSessionMock).toHaveBeenCalledTimes(1)
    expect(releaseSessionMock).not.toHaveBeenCalled()

    await act(async () => {
      clientA.emitState('reconnecting')
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      resolveAcquire({ held: true })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(releaseSessionMock).not.toHaveBeenCalled()
    expect(updateNotificationMock).toHaveBeenCalledWith('Orca Pet — Reconnecting...')

    await act(async () => {
      renderer?.unmount()
      await Promise.resolve()
    })
    expect(releaseSessionMock).toHaveBeenCalledTimes(1)
  })
})
