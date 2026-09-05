import { useEffect, type MutableRefObject } from 'react'
import type { DictationState } from '../../../../shared/speech-types'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { canStartVoiceDictation } from '../../../../shared/voice-dictation-selection'
import { DICTATION_CONTROL_EVENT, type DictationControlAction } from './dictation-control-events'

type DictationStartStopBindingsOptions = {
  dictationStateRef: MutableRefObject<DictationState>
  settings: GlobalSettings | null
  startDictation: () => Promise<void> | void
  stopDictation: () => Promise<void> | void
}

function isListeningOrStarting(state: DictationState): boolean {
  return state === 'listening' || state === 'starting'
}

export function useDictationStartStopBindings({
  dictationStateRef,
  settings,
  startDictation,
  stopDictation
}: DictationStartStopBindingsOptions): void {
  // Toggle mode: use IPC from main process (before-input-event intercepts
  // the keyDown so Cmd+E doesn't reach xterm or trigger system shortcuts).
  useEffect(() => {
    const mode = settings?.voice?.dictationMode ?? 'toggle'
    if (mode !== 'toggle') {
      return
    }

    const handleKeyDown = (): void => {
      if (!canStartVoiceDictation(settings?.voice) || dictationStateRef.current === 'stopping') {
        return
      }
      if (isListeningOrStarting(dictationStateRef.current)) {
        void stopDictation()
      } else {
        void startDictation()
      }
    }

    return window.api.ui.onDictationKeyDown(handleKeyDown)
  }, [
    dictationStateRef,
    settings?.voice,
    settings?.voice?.dictationMode,
    settings?.voice?.enabled,
    startDictation,
    stopDictation
  ])

  useEffect(() => {
    const handleControl = (event: Event): void => {
      if (!canStartVoiceDictation(settings?.voice) || dictationStateRef.current === 'stopping') {
        return
      }
      const action = (event as CustomEvent<DictationControlAction>).detail
      if (action === 'start') {
        if (dictationStateRef.current === 'idle') {
          void startDictation()
        }
        return
      }
      if (action === 'stop') {
        if (isListeningOrStarting(dictationStateRef.current)) {
          void stopDictation()
        }
        return
      }
      if (isListeningOrStarting(dictationStateRef.current)) {
        void stopDictation()
      } else {
        void startDictation()
      }
    }
    document.addEventListener(DICTATION_CONTROL_EVENT, handleControl)
    return () => document.removeEventListener(DICTATION_CONTROL_EVENT, handleControl)
  }, [dictationStateRef, settings?.voice, startDictation, stopDictation])
}
