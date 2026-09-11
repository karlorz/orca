import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  CAPTION_HUD_DEFAULT_TOP,
  CAPTION_HUD_FONT_SIZE,
  CAPTION_OFFSET_STORAGE_KEY,
  PetSpeakCaptionHud
} from './pet-speak-caption-hud'

vi.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles },
  PanResponder: {
    create: () => ({ panHandlers: {} })
  }
}))

vi.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>()
  return {
    default: {
      getItem: vi.fn(async (key: string) => store.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => {
        store.set(key, value)
      }),
      getAllKeys: vi.fn(async () => Array.from(store.keys())),
      removeItem: vi.fn(async (key: string) => {
        store.delete(key)
      }),
      clear: vi.fn(async () => {
        store.clear()
      })
    }
  }
})

describe('PetSpeakCaptionHud', () => {
  beforeEach(async () => {
    await AsyncStorage.clear()
  })

  it('uses a pass-through overlay, a hittable pill, YouTube-like type, and default top so the composer stays free', async () => {
    let tree: ReturnType<typeof create>
    await act(async () => {
      tree = create(
        createElement(PetSpeakCaptionHud, {
          caption: { eventId: 'e1', text: '測試字幕顯示' }
        })
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    const overlay = tree!.root.findByProps({ testID: 'pet-speak-caption-overlay' })
    const pill = tree!.root.findByProps({ testID: 'pet-speak-caption-pill' })
    const text = tree!.root.findByProps({ testID: 'pet-speak-caption-text' })

    expect(overlay.props.pointerEvents).toBe('box-none')
    expect(overlay.props.style.top).toBe(0)
    expect(overlay.props.style.bottom).toBe(0)
    expect(pill.props.pointerEvents).toBe('auto')
    expect(pill.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ top: CAPTION_HUD_DEFAULT_TOP, left: 16 })])
    )
    expect(text.props.style.fontSize).toBe(CAPTION_HUD_FONT_SIZE)
    expect(text.props.style.color).toBe('#ffffff')
    expect(text.props.children).toBe('測試字幕顯示')
  })

  it('calls onDisable from the close control so captions can be turned off without opening settings', async () => {
    const onDisable = vi.fn()
    let tree: ReturnType<typeof create>
    await act(async () => {
      tree = create(
        createElement(PetSpeakCaptionHud, {
          caption: { eventId: 'e1', text: '關閉' },
          onDisable
        })
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    const close = tree!.root.findByProps({ testID: 'pet-speak-caption-disable' })
    expect(close.props.accessibilityLabel).toBe('Turn off live captions')
    act(() => {
      close.props.onPress()
    })
    expect(onDisable).toHaveBeenCalledTimes(1)
  })

  it('restores a saved drag offset so the pill stays where the operator moved it', async () => {
    await AsyncStorage.setItem(CAPTION_OFFSET_STORAGE_KEY, JSON.stringify({ x: 12, y: 80 }))
    let tree: ReturnType<typeof create>
    await act(async () => {
      tree = create(
        createElement(PetSpeakCaptionHud, {
          caption: { eventId: 'e1', text: '拖動' }
        })
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    const pill = tree!.root.findByProps({ testID: 'pet-speak-caption-pill' })
    expect(pill.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          top: CAPTION_HUD_DEFAULT_TOP + 80,
          left: 16 + 12
        })
      ])
    )
  })

  it('renders original English under the spoken line when originalText is set', async () => {
    let tree: ReturnType<typeof create>
    await act(async () => {
      tree = create(
        createElement(PetSpeakCaptionHud, {
          caption: {
            eventId: 'e1',
            text: '你好！我係你嘅桌面寵物。',
            originalText: 'Hello! I am your desktop pet.'
          }
        })
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    const spoken = tree!.root.findByProps({ testID: 'pet-speak-caption-text' })
    const original = tree!.root.findByProps({ testID: 'pet-speak-caption-original' })
    // The first sentence of "你好！我係你嘅桌面寵物。" is "你好！"
    expect(spoken.props.children).toBe('你好！')
    expect(original.props.children).toBe('Hello! I am your desktop pet.')
    expect(original.props.style.fontSize).toBe(13)
  })

  it('paints a karaoke background on the current spoken range', async () => {
    let tree: ReturnType<typeof create>
    await act(async () => {
      tree = create(
        createElement(PetSpeakCaptionHud, {
          caption: { eventId: 'e1', text: '你好世界' },
          highlightRange: { start: 2, end: 4 }
        })
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    const karaoke = tree!.root.findByProps({ testID: 'pet-speak-caption-karaoke' })
    expect(karaoke.props.children).toBe('世界')
    expect(karaoke.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          backgroundColor: 'rgba(255, 214, 10, 0.55)',
          color: '#FFD60A'
        })
      ])
    )
  })

  it('omits the original English line when originalText is absent', async () => {
    let tree: ReturnType<typeof create>
    await act(async () => {
      tree = create(
        createElement(PetSpeakCaptionHud, {
          caption: { eventId: 'e1', text: '你好' }
        })
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(() => tree!.root.findByProps({ testID: 'pet-speak-caption-original' })).toThrow()
  })

  it('pill pet-speak-caption-text shows full spoken caption.text even when original_text is >240 / truncated', async () => {
    const longSpokenText = '呢句係好長嘅說話內容。'.repeat(10)
    let tree: ReturnType<typeof create>
    await act(async () => {
      tree = create(
        createElement(PetSpeakCaptionHud, {
          caption: {
            eventId: 'e1',
            text: longSpokenText,
            originalText: undefined
          }
        })
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    const spoken = tree!.root.findByProps({ testID: 'pet-speak-caption-text' })
    expect(spoken).toBeDefined()
    // Does not switch to original_text, and shows first sentence of spoken text
    expect(spoken.props.children).toBe('呢句係好長嘅說話內容。')
  })

  it('shows only the sentence containing the current karaoke range and maps local karaoke offsets', async () => {
    const sentence1 = '第一句講緊嘢。' // indices: 0:第 1:一 2:句 3:講 4:緊 5:嘢 6:。 (length 7)
    const sentence2 = '第二句先至係重點！' // indices in fullText: 7:第 8:二 9:句 ...
    const fullText = `${sentence1}${sentence2}`

    let tree: ReturnType<typeof create>
    // Sentence 1 active: highlight range [3, 5) -> "講緊"
    await act(async () => {
      tree = create(
        createElement(PetSpeakCaptionHud, {
          caption: { eventId: 'e1', text: fullText },
          highlightRange: { start: 3, end: 5 }
        })
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    let karaoke = tree!.root.findByProps({ testID: 'pet-speak-caption-karaoke' })
    expect(karaoke.props.children).toBe('講緊')

    // Highlight at the very last code point of sentence 1 still shows sentence 1
    await act(async () => {
      tree.update(
        createElement(PetSpeakCaptionHud, {
          caption: { eventId: 'e1', text: fullText },
          highlightRange: { start: sentence1.length - 1, end: sentence1.length }
        })
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    karaoke = tree!.root.findByProps({ testID: 'pet-speak-caption-karaoke' })
    expect(karaoke.props.children).toBe('。')

    // First highlight past terminator shows sentence 2
    await act(async () => {
      tree.update(
        createElement(PetSpeakCaptionHud, {
          caption: { eventId: 'e1', text: fullText },
          highlightRange: { start: sentence1.length, end: sentence1.length + 2 }
        })
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    karaoke = tree!.root.findByProps({ testID: 'pet-speak-caption-karaoke' })
    expect(karaoke.props.children).toBe('第二')
  })
})
