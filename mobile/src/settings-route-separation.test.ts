import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const pushedRoutes: string[] = []
const backCalled: number[] = []

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Switch: 'Switch',
  Text: 'Text',
  View: 'View',
  ActivityIndicator: 'ActivityIndicator',
  Platform: { OS: 'android', Version: 34 }
}))

vi.mock('expo-router', () => ({
  useRouter: () => ({
    push: (route: string) => pushedRoutes.push(route),
    back: () => backCalled.push(Date.now())
  }),
  useFocusEffect: vi.fn()
}))

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 })
}))

vi.mock('lucide-react-native', () => {
  const Icon = 'Icon'
  return {
    ChevronLeft: Icon,
    ChevronRight: Icon,
    Sparkles: Icon,
    Mic: Icon,
    Play: Icon,
    Info: Icon,
    Bell: Icon,
    Wrench: Icon,
    Shield: Icon,
    LifeBuoy: Icon,
    Globe: Icon,
    MessageSquare: Icon,
    Terminal: Icon,
    KeyRound: Icon,
    Gauge: Icon
  }
})

vi.mock('../src/transport/host-credential-cleanup', () => ({
  loadPendingHostCredentialCleanup: vi.fn(async () => ({ ids: [], storageUnreadable: false })),
  subscribePendingHostCredentialCleanup: vi.fn(() => () => {})
}))

vi.mock('../src/transport/host-store', () => ({
  loadHosts: vi.fn(async () => []),
  retryPendingHostCredentialCleanup: vi.fn(async () => ({
    remainingIds: [],
    storageUnreadable: false
  }))
}))

vi.mock('../src/transport/settings-host-client-connections', () => ({
  useFocusedSettingsHostClients: vi.fn(() => ({ clients: [], focused: true }))
}))

vi.mock('../src/dictation/use-dictation-setup-poller', () => ({
  useDictationSetupPoller: vi.fn(() => () => {})
}))

vi.mock('../src/dictation/mobile-dictation-setup', () => ({
  fetchDictationSetup: vi.fn(async () => ({
    enabled: true,
    dictationMode: 'toggle',
    selectedModelId: 'm1',
    models: [{ id: 'm1', label: 'Model 1', state: 'ready' }]
  })),
  setDictationConfig: vi.fn(async () => ({})),
  downloadDictationModel: vi.fn(async () => {}),
  deleteDictationModel: vi.fn(async () => {}),
  isModelInFlight: vi.fn(() => false)
}))

vi.mock('../src/components/BottomDrawer', () => ({
  BottomDrawer: ({ children }: { children?: unknown }) => children
}))

vi.mock('../src/components/VoiceModelList', () => ({
  VoiceModelList: () => null
}))

vi.mock('../src/pet-speak/pet-speech-preferences', () => ({
  loadPetSpeechPreferences: vi.fn(async () => ({
    enabled: true,
    migrationCompleted: true,
    installUuid: 'uuid-1',
    rate: 1,
    captionsEnabled: false,
    captionOffset: { x: 0, y: 0 },
    voiceByLanguage: {}
  })),
  subscribePetSpeechPreferences: vi.fn((_cb: unknown) => () => {}),
  setPetSpeechEnabled: vi.fn(async () => {}),
  setPetSpeechCaptionsEnabled: vi.fn(async () => {}),
  setPetSpeechRate: vi.fn(async () => {}),
  setPetSpeechVoiceForLanguage: vi.fn(async () => {})
}))

vi.mock('../src/pet-speak/pet-speech-service', () => ({
  getAvailablePetSpeechVoices: vi.fn(async () => []),
  executeTestVoiceAsync: vi.fn(async () => ({ outcome: 'spoken' })),
  validatePetSpeechVoice: vi.fn(() => ({ valid: true, status: 'valid' }))
}))

import SettingsScreen from '../app/settings'
import VoiceSettingsScreen from '../app/voice-settings'

describe('Root Settings -> Voice and Plugins separation', () => {
  beforeEach(() => {
    pushedRoutes.length = 0
    backCalled.length = 0
    vi.clearAllMocks()
  })

  it('root Settings screen exposes both Voice and Plugins routes', async () => {
    let root: { root: { findAllByType: (type: string) => Array<{ props: { children: unknown } }> } }
    await act(async () => {
      root = create(createElement(SettingsScreen))
      await Promise.resolve()
    })

    const textNodes = root.root.findAllByType('Text')
    const labels = textNodes.flatMap((n) => n.props.children)

    expect(labels).toContain('Voice')
    expect(labels).toContain('Plugins')
  })

  it('VoiceSettingsScreen is isolated and renders dictation settings, not Pet Speech', async () => {
    let root: { root: { findAllByType: (type: string) => Array<{ props: { children: unknown } }> } }
    await act(async () => {
      root = create(createElement(VoiceSettingsScreen))
      await Promise.resolve()
    })

    const textNodes = root.root.findAllByType('Text')
    const labels = textNodes.flatMap((n) => n.props.children)

    expect(labels).toContain('Voice')
    expect(labels).not.toContain('Pet Speech')
  })
})
