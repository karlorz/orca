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
import { describe, expect, it, vi } from 'vitest'

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
  openHostLogicalClient: vi.fn()
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
import { applyPetSpeakLiveCaption } from './pet-speak-live-caption'
import { showPetSpeakCaptionPreview, hidePetSpeakCaptionPreview } from './pet-speak-caption-preview'
import { applyPetSpeakCaptionRange } from './pet-speak-caption-range'

describe('PetSpeakRootBridge live captions and preview', () => {
  it('renders live caption from the live-caption store, applies karaoke, and lets preview override', async () => {
    let renderer: ReactTestRenderer | null = null
    applyPetSpeakLiveCaption(null)
    hidePetSpeakCaptionPreview()
    applyPetSpeakCaptionRange(null)
    loadHostCatalogMock.mockResolvedValue([])

    await act(async () => {
      renderer = create(
        createElement(
          RpcClientProvider,
          null,
          createElement(PetSpeakRootBridge, {
            captionsEnabled: true
          })
        )
      )
      await Promise.resolve()
    })

    expect(renderer?.toJSON()).toBeNull()

    await act(async () => {
      applyPetSpeakLiveCaption({
        eventId: 'ev-live-1',
        text: 'Hello world live'
      })
      await Promise.resolve()
    })

    let json = JSON.stringify(renderer?.toJSON())
    expect(json).toContain('Hello world live')

    await act(async () => {
      applyPetSpeakCaptionRange({
        eventId: 'ev-live-1',
        start: 0,
        end: 5
      })
      await Promise.resolve()
    })
    json = JSON.stringify(renderer?.toJSON())
    expect(json).toContain('pet-speak-caption-karaoke')
    expect(json).toContain('Hello')
    expect(json).toContain(' world live')

    await act(async () => {
      showPetSpeakCaptionPreview('Preview caption text')
      await Promise.resolve()
    })
    json = JSON.stringify(renderer?.toJSON())
    expect(json).toContain('Preview caption text')
    expect(json).not.toContain('Hello world live')

    await act(async () => {
      hidePetSpeakCaptionPreview()
      await Promise.resolve()
    })
    json = JSON.stringify(renderer?.toJSON())
    expect(json).toContain('pet-speak-caption-karaoke')
    expect(json).toContain('Hello')
    expect(json).toContain(' world live')

    await act(async () => {
      applyPetSpeakLiveCaption(null)
      await Promise.resolve()
    })
    expect(renderer?.toJSON()).toBeNull()

    await act(async () => {
      renderer?.unmount()
    })
  })
})
