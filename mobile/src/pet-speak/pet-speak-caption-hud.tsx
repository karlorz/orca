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
import {
  PET_SPEECH_STORAGE_KEYS,
  loadPetSpeechPreferences,
  setPetSpeechCaptionOffset
} from './pet-speech-preferences'
import type { PetSpeakCaption } from './pet-speak-types'

export const CAPTION_OFFSET_STORAGE_KEY = PET_SPEECH_STORAGE_KEYS.CAPTION_OFFSET
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
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 9999
  },
  pill: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: '92%',
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
  const offsetRef = useRef<CaptionOffset>({ x: 0, y: 0 })
  const startRef = useRef<CaptionOffset>({ x: 0, y: 0 })

  const applyOffset = (next: CaptionOffset): void => {
    offsetRef.current = next
    setOffset(next)
  }

  useEffect(() => {
    let active = true
    void loadPetSpeechPreferences().then((prefs) => {
      if (!active) {
        return
      }
      applyOffset(prefs.captionOffset)
    })
    return () => {
      active = false
    }
  }, [])

  const persistOffset = (next: CaptionOffset): void => {
    applyOffset(next)
    void setPetSpeechCaptionOffset(next)
  }

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (
          _evt: GestureResponderEvent,
          gesture: PanResponderGestureState
        ) => Math.abs(gesture.dx) > 4 || Math.abs(gesture.dy) > 4,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          startRef.current = offsetRef.current
        },
        onPanResponderMove: (_evt, gesture) => {
          applyOffset({
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
    []
  )

  return (
    <View style={styles.overlay} pointerEvents="box-none" testID="pet-speak-caption-overlay">
      <View
        style={[
          styles.pill,
          {
            top: CAPTION_HUD_DEFAULT_TOP + offset.y,
            left: 16 + offset.x
          }
        ]}
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
