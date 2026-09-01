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
    Play: Icon,
    Captions: Icon,
    Subtitles: Icon
  }
})

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
  validatePetSpeechVoice: vi.fn(() => ({ valid: true, status: 'valid' })),
  TEST_VOICE_SAMPLES: {
    'yue-HK': {
      spoken: '你好！我係你嘅桌面寵物。今日天氣幾好，我哋一齊處理 123 件事啦！',
      original:
        'Hello! I am your desktop pet. The weather is nice today — let’s handle 123 things together!'
    },
    'zh-CN': {
      spoken: '你好！我是你的桌面宠物。今天天气不错，我们一起处理 123 件事吧！',
      original:
        'Hello! I am your desktop pet. The weather is nice today — let’s handle 123 things together!'
    },
    'zh-TW': {
      spoken: '你好！我是你的桌面寵物。今天天氣不錯，我們一起處理 123 件事吧！',
      original:
        'Hello! I am your desktop pet. The weather is nice today — let’s handle 123 things together!'
    },
    'en-US': {
      spoken: 'Hello! I am your desktop pet. Let us handle 123 tasks together today!'
    }
  }
}))

import PluginsSettingsScreen from '../app/plugins-settings'
import PetSpeechSettingsScreen from '../app/pet-speech-settings'
import { executeTestVoiceAsync } from '../src/pet-speak/pet-speech-service'
import {
  getPetSpeakCaptionPreview,
  hidePetSpeakCaptionPreview
} from '../src/pet-speak/pet-speak-caption-preview'

describe('Pet Speech and Plugins Routes', () => {
  beforeEach(() => {
    pushedRoutes.length = 0
    backCalled.length = 0
    vi.clearAllMocks()
    hidePetSpeakCaptionPreview()
  })

  it('PluginsSettingsScreen renders title and Pet Speech row', async () => {
    let root: { root: { findAllByType: (type: string) => Array<{ props: { children: unknown } }> } }
    await act(async () => {
      root = create(createElement(PluginsSettingsScreen))
      await Promise.resolve()
    })

    const textNodes = root.root.findAllByType('Text')
    const labels = textNodes.map((n) =>
      Array.isArray(n.props.children) ? n.props.children.join('') : n.props.children
    )

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
    const labels = textNodes.map((n) =>
      Array.isArray(n.props.children) ? n.props.children.join('') : n.props.children
    )

    expect(labels).toContain('Pet Speech')
    expect(labels).toContain('Enable Pet Speech')
    expect(labels).toContain('Live captions')
    expect(labels).toContain('TEST')
    expect(labels).toContain('Test Voice (yue-HK)')
    expect(labels).toContain('Test Live captions')
    expect(labels).toContain('Selected voice: Device default')
  })

  it('PetSpeechSettingsScreen shows explicit selected voice name when configured', async () => {
    const prefsModule = await import('../src/pet-speak/pet-speech-preferences')
    vi.mocked(prefsModule.loadPetSpeechPreferences).mockResolvedValueOnce({
      enabled: true,
      migrationCompleted: true,
      installUuid: 'uuid-1',
      rate: 1,
      captionsEnabled: false,
      captionOffset: { x: 0, y: 0 },
      voiceByLanguage: { 'yue-HK': 'yue-hk-x-yuc-local' }
    })

    let root: { root: { findAllByType: (type: string) => Array<{ props: { children: unknown } }> } }
    await act(async () => {
      root = create(createElement(PetSpeechSettingsScreen))
      await Promise.resolve()
    })

    const textNodes = root.root.findAllByType('Text')
    const labels = textNodes.map((n) =>
      Array.isArray(n.props.children) ? n.props.children.join('') : n.props.children
    )

    expect(labels).toContain('Selected voice: yue-hk-x-yuc-local')
  })

  it('Test Voice shows Yue plus original English while speaking, then hides', async () => {
    let resolveSpeak: (value: { outcome: string }) => void = () => {}
    vi.mocked(executeTestVoiceAsync).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSpeak = resolve
        })
    )

    let root: {
      root: {
        findAllByType: (
          type: string
        ) => Array<{
          props: { children: unknown; onPress?: () => void }
          parent: { props: { onPress?: () => void } }
        }>
      }
    }
    await act(async () => {
      root = create(createElement(PetSpeechSettingsScreen))
      await Promise.resolve()
    })

    const label = root.root.findAllByType('Text').find((n) => {
      const children = n.props.children
      const text = Array.isArray(children) ? children.join('') : children
      return text === 'Test Voice (yue-HK)'
    })
    expect(label).toBeDefined()

    const pressable = label?.parent
    await act(async () => {
      pressable?.props.onPress?.()
      await Promise.resolve()
    })

    const preview = getPetSpeakCaptionPreview()
    expect(preview?.text).toContain('桌面寵物')
    expect(preview?.originalText).toContain('Hello! I am your desktop pet')

    await act(async () => {
      resolveSpeak({ outcome: 'spoken' })
      await Promise.resolve()
    })
    expect(getPetSpeakCaptionPreview()).toBeNull()
  })
})
