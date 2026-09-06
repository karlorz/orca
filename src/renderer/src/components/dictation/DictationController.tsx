import { useEffect, useRef, useCallback } from 'react'
import { useAppStore } from '@/store'
import { useAudioCapture } from '@/hooks/use-audio-capture'
import { toast } from 'sonner'
import { DictationIndicator } from './DictationIndicator'
import { captureInsertionTarget, type DictationInsertionTarget } from './dictation-insertion-target'
import {
  resolveDictationStopTranscript,
  shouldFinishDictationOnRemoteStop
} from './dictation-final-segments'
import { commitDictationFinalTranscript, showNoSpeechDetectedToast } from './dictation-commit-final'
import { recordStoppedSession, waitForStoppedSession } from './dictation-stopped-sessions'
import { translate } from '@/i18n/i18n'
import { showDictationStartErrorToast } from './dictation-start-error-toast'
import { useHoldDictationGesture } from './use-hold-dictation-gesture'
import { publishDictationMeter } from './dictation-meter-store'
import { useDictationStartStopBindings } from './use-dictation-start-stop-bindings'

import {
  canStartVoiceDictation,
  effectiveSttModel,
  isMacSpeechSelected
} from '../../../../shared/voice-dictation-selection'
import { createDictationLiveInserter, type DictationLiveInserter } from './dictation-live-insertion'

export function DictationController() {
  const dictationState = useAppStore((s) => s.dictationState)
  const setDictationState = useAppStore((s) => s.setDictationState)
  const setPartialTranscript = useAppStore((s) => s.setPartialTranscript)
  const recordFeatureInteraction = useAppStore((s) => s.recordFeatureInteraction)
  const settings = useAppStore((s) => s.settings)
  const keybindings = useAppStore((s) => s.keybindings)
  const {
    start: startCapture,
    stop: stopCapture,
    flushBufferedAudio,
    discardBufferedAudio,
    getCapturedChunkCount
  } = useAudioCapture(publishDictationMeter)

  const dictationStateRef = useRef(dictationState)
  dictationStateRef.current = dictationState
  const dictationRunRef = useRef(0)
  const holdGestureActiveRef = useRef(false)
  const insertionTargetRef = useRef<DictationInsertionTarget | null>(null)
  const activeSessionIdRef = useRef<string | null>(null)
  const stoppedSessionIdsRef = useRef(new Set<string>())
  const stoppedResolversRef = useRef(new Map<string, () => void>())
  const stopRequestedDuringStartRef = useRef(false)
  const finalTranscriptReceivedRef = useRef(false)
  const lastPartialTranscriptRef = useRef('')
  const erroredSessionIdsRef = useRef(new Set<string>())
  const intentionalTargetCancellationRef = useRef(false)
  const insertedFinalTranscriptRef = useRef('')
  // Why: push-to-talk restarts capture per utterance; toast once per preference,
  // not once per press, while the selected mic stays gone.
  const micFallbackNotifiedForRef = useRef<string | null>(null)
  const stopDictationRef = useRef<(() => void) | null>(null)
  const liveInserterRef = useRef<DictationLiveInserter>(createDictationLiveInserter(null))

  const drainStoppedSession = useCallback((sessionId: string) => {
    void waitForStoppedSession(sessionId, stoppedSessionIdsRef, stoppedResolversRef)
  }, [])

  const commitFinalTranscript = useCallback(
    (text: string) => {
      if (!text) {
        return
      }
      setPartialTranscript('')
      lastPartialTranscriptRef.current = ''
      finalTranscriptReceivedRef.current = true
      insertedFinalTranscriptRef.current = commitDictationFinalTranscript(
        text,
        insertionTargetRef.current,
        insertedFinalTranscriptRef.current,
        intentionalTargetCancellationRef.current
      )
    },
    [setPartialTranscript]
  )

  const finishDictationSession = useCallback(
    async (sessionId: string) => {
      dictationStateRef.current = 'stopping'
      setDictationState('stopping')
      stopCapture()
      try {
        await window.api.speech.stopDictation(sessionId)
      } catch {
        // Swallow stop errors — the worker may already be torn down.
      }
      // Why: stopDictation() resolves on main-process completion, while final
      // transcript delivery is renderer IPC. Wait for this session's stopped
      // event so old finals cannot be mistaken for the next dictation run.
      await waitForStoppedSession(sessionId, stoppedSessionIdsRef, stoppedResolversRef)
      const liveTarget = liveInserterRef.current.hasTarget
      if (!liveTarget) {
        const stopAction = resolveDictationStopTranscript({
          sessionErrored: erroredSessionIdsRef.current.delete(sessionId),
          receivedFinal: finalTranscriptReceivedRef.current,
          lastPartial: lastPartialTranscriptRef.current,
          capturedChunkCount: getCapturedChunkCount()
        })
        if (stopAction.type === 'commit') {
          commitFinalTranscript(stopAction.text)
        } else if (stopAction.type === 'empty') {
          showNoSpeechDetectedToast()
        }
      } else if (
        !finalTranscriptReceivedRef.current &&
        !lastPartialTranscriptRef.current.trim() &&
        getCapturedChunkCount() > 0
      ) {
        showNoSpeechDetectedToast()
      }
      liveInserterRef.current = createDictationLiveInserter(null)
      insertionTargetRef.current = null
      finalTranscriptReceivedRef.current = false
      lastPartialTranscriptRef.current = ''
      insertedFinalTranscriptRef.current = ''
      intentionalTargetCancellationRef.current = false
      stopRequestedDuringStartRef.current = false
      if (activeSessionIdRef.current === sessionId) {
        activeSessionIdRef.current = null
      }
      dictationStateRef.current = 'idle'
      setDictationState('idle')
      setPartialTranscript('')
    },
    [
      setDictationState,
      setPartialTranscript,
      stopCapture,
      getCapturedChunkCount,
      commitFinalTranscript
    ]
  )

  const startDictation = useCallback(async () => {
    if (dictationStateRef.current !== 'idle') {
      return
    }

    const modelId = effectiveSttModel(settings?.voice)
    if (!modelId) {
      toast('No speech model selected. Download one in Settings > Voice.', {
        action: {
          label: translate(
            'auto.components.dictation.DictationController.bb7f599ee7',
            'Open Settings'
          ),
          onClick: () => {
            useAppStore.getState().openSettingsTarget({ pane: 'voice', repoId: null })
            useAppStore.getState().openSettingsPage()
          }
        }
      })
      return
    }

    if (!canStartVoiceDictation(settings?.voice)) {
      toast('Voice dictation is disabled. Enable it in Settings > Voice.')
      return
    }

    const runId = dictationRunRef.current + 1
    const sessionId = String(runId)
    dictationRunRef.current = runId
    activeSessionIdRef.current = sessionId
    insertionTargetRef.current = captureInsertionTarget()
    liveInserterRef.current = isMacSpeechSelected(settings?.voice)
      ? createDictationLiveInserter(insertionTargetRef.current)
      : createDictationLiveInserter(null)
    stopRequestedDuringStartRef.current = false
    finalTranscriptReceivedRef.current = false
    lastPartialTranscriptRef.current = ''
    erroredSessionIdsRef.current.clear()
    insertedFinalTranscriptRef.current = ''
    intentionalTargetCancellationRef.current = false
    dictationStateRef.current = 'starting'
    setDictationState('starting')

    let captureStarted = false

    try {
      // Why: worker startup can take seconds after idle teardown. Capture first
      // and buffer locally so speech during "Starting..." is not discarded.
      const preferredMicrophoneDeviceId = settings?.voice?.microphoneDeviceId ?? null
      const captureResult = await startCapture({
        bufferAudio: true,
        sessionId,
        microphoneDeviceId: preferredMicrophoneDeviceId,
        microphoneDeviceLabel: settings?.voice?.microphoneDeviceLabel ?? null,
        onCaptureLost: () => {
          if (dictationRunRef.current !== runId) {
            return
          }
          toast.message(
            translate(
              'auto.components.dictation.DictationController.micDisconnected',
              'Microphone disconnected. Dictation stopped.'
            )
          )
          stopDictationRef.current?.()
        }
      })
      captureStarted = true
      if (captureResult?.fellBackToDefaultMicrophone) {
        // Why: a stop requested during startup tears this capture down below, so the
        // notice would describe a fallback that never records anything.
        if (
          !stopRequestedDuringStartRef.current &&
          micFallbackNotifiedForRef.current !== preferredMicrophoneDeviceId
        ) {
          micFallbackNotifiedForRef.current = preferredMicrophoneDeviceId
          toast.message(
            translate(
              'auto.components.dictation.DictationController.micFallback',
              'Selected microphone unavailable. Using system default.'
            )
          )
        }
      } else {
        micFallbackNotifiedForRef.current = null
      }
      if (stopRequestedDuringStartRef.current) {
        stopCapture({ preserveBufferedAudio: true })
      }
      if (dictationRunRef.current !== runId) {
        discardBufferedAudio()
        stopCapture()
        insertionTargetRef.current = null
        return
      }

      await window.api.speech.startDictation(modelId, undefined, sessionId)
      if (dictationRunRef.current !== runId) {
        discardBufferedAudio()
        insertionTargetRef.current = null
        stopCapture()
        await window.api.speech.stopDictation(sessionId).catch(() => undefined)
        drainStoppedSession(sessionId)
        return
      }

      await flushBufferedAudio()
      if (dictationRunRef.current !== runId) {
        discardBufferedAudio()
        insertionTargetRef.current = null
        stopCapture()
        await window.api.speech.stopDictation(sessionId).catch(() => undefined)
        drainStoppedSession(sessionId)
        return
      }
      if (stopRequestedDuringStartRef.current) {
        await finishDictationSession(sessionId)
        return
      }

      dictationStateRef.current = 'listening'
      setDictationState('listening')
      recordFeatureInteraction('voice-dictation')
    } catch (err) {
      if (dictationRunRef.current !== runId) {
        return
      }
      await window.api.speech.stopDictation(sessionId).catch(() => undefined)
      drainStoppedSession(sessionId)
      if (captureStarted) {
        stopCapture()
      }
      discardBufferedAudio()
      const message = String(err)
      insertionTargetRef.current = null
      liveInserterRef.current = createDictationLiveInserter(null)
      intentionalTargetCancellationRef.current = false
      stopRequestedDuringStartRef.current = false
      finalTranscriptReceivedRef.current = false
      lastPartialTranscriptRef.current = ''
      erroredSessionIdsRef.current.clear()
      insertedFinalTranscriptRef.current = ''
      activeSessionIdRef.current = null
      setPartialTranscript('')
      if (message.includes('dictation_canceled')) {
        dictationStateRef.current = 'idle'
        setDictationState('idle')
        return
      }
      dictationStateRef.current = 'error'
      setDictationState('error')
      showDictationStartErrorToast(message)
      dictationStateRef.current = 'idle'
      setDictationState('idle')
    }
  }, [
    settings,
    setDictationState,
    startCapture,
    flushBufferedAudio,
    discardBufferedAudio,
    stopCapture,
    finishDictationSession,
    drainStoppedSession,
    setPartialTranscript,
    recordFeatureInteraction
  ])

  const stopDictation = useCallback(async () => {
    if (dictationStateRef.current === 'starting') {
      stopRequestedDuringStartRef.current = true
      dictationStateRef.current = 'stopping'
      setDictationState('stopping')
      stopCapture({ preserveBufferedAudio: true })
      return
    }

    if (dictationStateRef.current !== 'listening') {
      return
    }

    const sessionId = activeSessionIdRef.current
    if (!sessionId) {
      return
    }
    await finishDictationSession(sessionId)
  }, [finishDictationSession, setDictationState, stopCapture])

  // Why: capture-loss fires from a stream opened before stopDictation exists;
  // route through a ref so the two callbacks do not depend on each other.
  stopDictationRef.current = () => void stopDictation()

  useDictationStartStopBindings({
    dictationStateRef,
    settings,
    startDictation,
    stopDictation
  })

  useHoldDictationGesture({
    dictationStateRef,
    holdGestureActiveRef,
    insertionTargetRef,
    intentionalTargetCancellationRef,
    keybindings,
    settings,
    startDictation,
    stopDictation
  })

  useEffect(() => {
    const cleanupPartial = window.api.speech.onPartialTranscript((data) => {
      if (data.sessionId !== activeSessionIdRef.current) {
        return
      }
      lastPartialTranscriptRef.current = data.text
      if (liveInserterRef.current.hasTarget) {
        liveInserterRef.current.applyPartial(data.text)
        setPartialTranscript('')
        return
      }
      setPartialTranscript(data.text)
    })

    const cleanupFinal = window.api.speech.onFinalTranscript((data) => {
      if (data.sessionId !== activeSessionIdRef.current || !data.text) {
        return
      }
      if (liveInserterRef.current.hasTarget) {
        liveInserterRef.current.freezeSegment(data.text)
        finalTranscriptReceivedRef.current = true
        lastPartialTranscriptRef.current = ''
        setPartialTranscript('')
        return
      }
      commitFinalTranscript(data.text)
    })

    const cleanupStopped = window.api.speech.onStopped((data) => {
      recordStoppedSession(data.sessionId, stoppedSessionIdsRef, stoppedResolversRef)
      // Why: Mac speech ends the listen after a pause (Apple isFinal). Other
      // models only emit stopped after an explicit user stop, which already
      // moved state to 'stopping' so this does not re-enter.
      if (
        data.sessionId === activeSessionIdRef.current &&
        shouldFinishDictationOnRemoteStop(dictationStateRef.current)
      ) {
        void finishDictationSession(data.sessionId)
      }
    })

    const cleanupError = window.api.speech.onError((data) => {
      if (data.sessionId !== activeSessionIdRef.current) {
        return
      }
      const sessionId = data.sessionId
      erroredSessionIdsRef.current.add(sessionId)
      dictationRunRef.current += 1
      activeSessionIdRef.current = null
      toast.error(
        translate(
          'auto.components.dictation.DictationController.de136f1199',
          'Speech error: {{value0}}',
          { value0: data.error }
        )
      )
      dictationStateRef.current = 'stopping'
      setDictationState('stopping')
      stopCapture()
      discardBufferedAudio()
      void (async () => {
        await window.api.speech.stopDictation(sessionId).catch(() => undefined)
        await waitForStoppedSession(sessionId, stoppedSessionIdsRef, stoppedResolversRef)
        insertionTargetRef.current = null
        intentionalTargetCancellationRef.current = false
        stopRequestedDuringStartRef.current = false
        finalTranscriptReceivedRef.current = false
        lastPartialTranscriptRef.current = ''
        insertedFinalTranscriptRef.current = ''
        dictationStateRef.current = 'idle'
        setDictationState('idle')
        setPartialTranscript('')
      })()
    })

    return () => {
      cleanupPartial()
      cleanupFinal()
      cleanupStopped()
      cleanupError()
    }
  }, [
    setPartialTranscript,
    setDictationState,
    stopCapture,
    discardBufferedAudio,
    commitFinalTranscript,
    finishDictationSession
  ])

  return <DictationIndicator />
}
