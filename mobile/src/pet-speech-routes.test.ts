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
  useFocusEffect: vi.fn((cb: () => void) => cb())
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
    Play: Icon
  }
})

vi.mock('../src/pet-speak/pet-speech-preferences', () => ({
  loadPetSpeechPreferences: vi.fn(async () => ({
    enabled: true,
    migrationCompleted: true,
    installUuid: 'uuid-1',
    rate: 1,
    voiceByLanguage: {}
  })),
  subscribePetSpeechPreferences: vi.fn((_cb: unknown) => () => {}),
  setPetSpeechEnabled: vi.fn(async () => {}),
  setPetSpeechRate: vi.fn(async () => {}),
  setPetSpeechVoiceForLanguage: vi.fn(async () => {})
}))

vi.mock('../src/pet-speak/pet-speech-service', () => ({
  getAvailablePetSpeechVoices: vi.fn(async () => []),
  executeTestVoiceAsync: vi.fn(async () => ({ outcome: 'spoken' })),
  validatePetSpeechVoice: vi.fn(() => ({ valid: true, status: 'valid' }))
}))

import PluginsSettingsScreen from '../app/plugins-settings'
import PetSpeechSettingsScreen from '../app/pet-speech-settings'

describe('Pet Speech and Plugins Routes', () => {
  beforeEach(() => {
    pushedRoutes.length = 0
    backCalled.length = 0
    vi.clearAllMocks()
  })

  it('PluginsSettingsScreen renders title and Pet Speech row', async () => {
    let root: { root: { findAllByType: (type: string) => Array<{ props: { children: unknown } }> } }
    await act(async () => {
      root = create(createElement(PluginsSettingsScreen))
      await Promise.resolve()
    })

    const textNodes = root.root.findAllByType('Text')
    const labels = textNodes.flatMap((n) => n.props.children)

    expect(labels).toContain('Plugins')
    expect(labels).toContain('Pet Speech')
  })

  it('PetSpeechSettingsScreen renders Pet Speech master switch and controls', async () => {
    let root: { root: { findAllByType: (type: string) => Array<{ props: { children: unknown } }> } }
    await act(async () => {
      root = create(createElement(PetSpeechSettingsScreen))
      await Promise.resolve()
    })

    const textNodes = root.root.findAllByType('Text')
    const labels = textNodes.flatMap((n) => n.props.children)

    expect(labels).toContain('Pet Speech')
    expect(labels).toContain('Enable Pet Speech')
  })
})
