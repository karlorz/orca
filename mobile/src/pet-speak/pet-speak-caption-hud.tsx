import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import {
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type PanResponderGestureState
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { PetSpeakCaption } from './pet-speak-types'

export const CAPTION_OFFSET_STORAGE_KEY = 'orca:petSpeech:captionOffset'
export const CAPTION_HUD_FONT_SIZE = 18
export const CAPTION_HUD_DEFAULT_TOP = 56

type CaptionOffset = { x: number; y: number }

export interface PetSpeakCaptionHudProps {
  caption: PetSpeakCaption
  onDisable?: () => void
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: CAPTION_HUD_DEFAULT_TOP,
    left: 16,
    right: 16,
    zIndex: 9999,
    alignItems: 'center'
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: '100%',
    backgroundColor: 'rgba(0, 0, 0, 0.78)',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    gap: 10
  },
  text: {
    flexShrink: 1,
    color: '#ffffff',
    fontSize: CAPTION_HUD_FONT_SIZE,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 24
  },
  close: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center'
  },
  closeLabel: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 16,
    lineHeight: 18,
    fontWeight: '700'
  }
})

export function PetSpeakCaptionHud(props: PetSpeakCaptionHudProps): ReactElement {
  const [offset, setOffset] = useState<CaptionOffset>({ x: 0, y: 0 })
  const startRef = useRef<CaptionOffset>({ x: 0, y: 0 })

  useEffect(() => {
    let active = true
    void AsyncStorage.getItem(CAPTION_OFFSET_STORAGE_KEY).then((raw) => {
      if (!active || !raw) {
        return
      }
      try {
        const parsed = JSON.parse(raw) as CaptionOffset
        if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') {
          setOffset({ x: parsed.x, y: parsed.y })
        }
      } catch {
        // ignore corrupt offset
      }
    })
    return () => {
      active = false
    }
  }, [])

  const persistOffset = (next: CaptionOffset): void => {
    setOffset(next)
    void AsyncStorage.setItem(CAPTION_OFFSET_STORAGE_KEY, JSON.stringify(next))
  }

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (
          _evt: GestureResponderEvent,
          gesture: PanResponderGestureState
        ) => Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2,
        onPanResponderGrant: () => {
          startRef.current = offset
        },
        onPanResponderMove: (_evt, gesture) => {
          setOffset({
            x: startRef.current.x + gesture.dx,
            y: startRef.current.y + gesture.dy
          })
        },
        onPanResponderRelease: (_evt, gesture) => {
          persistOffset({
            x: startRef.current.x + gesture.dx,
            y: startRef.current.y + gesture.dy
          })
        }
      }),
    [offset]
  )

  return (
    <View style={styles.overlay} pointerEvents="box-none" testID="pet-speak-caption-overlay">
      <View
        style={[styles.pill, { transform: [{ translateX: offset.x }, { translateY: offset.y }] }]}
        pointerEvents="auto"
        testID="pet-speak-caption-pill"
        {...panResponder.panHandlers}
      >
        <Text style={styles.text} numberOfLines={3} testID="pet-speak-caption-text">
          {props.caption.text}
        </Text>
        {props.onDisable ? (
          <Pressable
            accessibilityLabel="Turn off live captions"
            hitSlop={8}
            onPress={props.onDisable}
            style={styles.close}
            testID="pet-speak-caption-disable"
          >
            <Text style={styles.closeLabel}>×</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  )
}
