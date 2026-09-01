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
    })
    const overlay = tree!.root.findByProps({ testID: 'pet-speak-caption-overlay' })
    const pill = tree!.root.findByProps({ testID: 'pet-speak-caption-pill' })
    const text = tree!.root.findByProps({ testID: 'pet-speak-caption-text' })

    expect(overlay.props.pointerEvents).toBe('box-none')
    expect(overlay.props.style.top).toBe(CAPTION_HUD_DEFAULT_TOP)
    expect(pill.props.pointerEvents).toBe('auto')
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
        expect.objectContaining({ transform: [{ translateX: 12 }, { translateY: 80 }] })
      ])
    )
  })
})
