import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Platform } from 'react-native'
import type { ConnectionState, HostCatalogEntry, HostProfile } from '../transport/types'
import { loadHostCatalog } from '../transport/host-store'
import { selectConnectableHostProfiles } from '../transport/host-catalog-selection'
import { useAllHostClients } from '../transport/use-all-host-clients'
import { useRpcClientContext } from '../transport/client-context'
import type { PetSpeakCaption, PetSpeakHandlerOptions } from './pet-speak-types'
import { getPetSpeechNativeAdapter } from './pet-speak-native-adapter'
import { ensureNotificationPermissions as defaultEnsureNotificationPermissions } from '../notifications/notification-permissions'
import {
  loadPetSpeechPreferences,
  setPetSpeechCaptionsEnabled,
  subscribePetSpeechPreferences,
  type PetSpeechPreferences
} from './pet-speech-preferences'
import {
  getPetSpeakCaptionPreview,
  hidePetSpeakCaptionPreview,
  subscribePetSpeakCaptionPreview
} from './pet-speak-caption-preview'
import { getPetSpeakLiveCaption, subscribePetSpeakLiveCaption } from './pet-speak-live-caption'
import { PetSpeakCaptionHud } from './pet-speak-caption-hud'
import {
  applyPetSpeakCaptionRange,
  subscribePetSpeakCaptionRange,
  type PetSpeakCaptionRangeEvent
} from './pet-speak-caption-range'
import { attachNativeCaptionRangeListener } from './pet-speak-caption-range-native'
import { setHostConnectionRetainRuntime } from './host-connection-retain'
import { syncPetSpeechPersistSettings } from './pet-speech-persist-checklist'
import { preparePetSpeakEvent } from './pet-speech-service'
import { wirePetSpeakHostClients } from './pet-speak-root-bridge-subscriptions'
import {
  clearPetVoiceGraceTimer,
  evaluatePetVoiceHold,
  idlePetVoiceHoldState,
  type PetSpeakSubscriptionEntry,
  type PetVoiceHoldRuntime
} from './pet-speak-root-bridge-hold'
import { PET_SPEAK_RETRY_DELAYS_MS } from './pet-speak-subscription-recovery'

export { PET_VOICE_RECONNECT_GRACE_MS } from './pet-voice-hold-decision'

export { PET_SPEAK_RETRY_DELAYS_MS }

export interface PetSpeakBridgeOptions {
  loadCatalog?: () => Promise<HostCatalogEntry[]>
  subscribeToCatalogChange?: (listener: () => void) => () => void
  handlerOptions?: PetSpeakHandlerOptions
  isAndroid?: boolean
  ensureNotificationPermissions?: () => Promise<boolean>
  acquireVoiceSession?: () => Promise<{ held: boolean }>
  releaseVoiceSession?: () => Promise<void>
  updateVoiceSessionNotification?: (text: string) => Promise<void>
  loadPreferences?: () => Promise<PetSpeechPreferences>
  subscribePreferences?: (listener: (prefs: PetSpeechPreferences) => void) => () => void
  caption?: PetSpeakCaption | null
  captionsEnabled?: boolean
}

export function usePetSpeakRootBridge(
  options?: PetSpeakBridgeOptions,
  onCaptionChange?: (caption: PetSpeakCaption | null) => void
): boolean {
  const ctx = useRpcClientContext()
  const [connectableProfiles, setConnectableProfiles] = useState<HostProfile[]>([])
  const loadCatalogFn = options?.loadCatalog ?? loadHostCatalog
  const subscribeToCatalogChange = options?.subscribeToCatalogChange ?? ctx.subscribeAllHosts
  const loadPreferencesFn = options?.loadPreferences ?? loadPetSpeechPreferences
  const subscribePreferencesFn = options?.subscribePreferences ?? subscribePetSpeechPreferences
  const primeHosts = ctx.primeHosts
  const catalogGenerationRef = useRef(0)
  const isDisposedRef = useRef(false)

  const [preferences, setPreferences] = useState<PetSpeechPreferences | null>(() => {
    return null
  })

  // Load and subscribe to Pet Speech Enabled preferences
  useEffect(() => {
    let active = true
    void loadPreferencesFn().then((prefs) => {
      if (active && !isDisposedRef.current) {
        setPreferences({ ...prefs })
      }
    })
    const unsub = subscribePreferencesFn((prefs) => {
      if (active && !isDisposedRef.current) {
        setPreferences({ ...prefs })
      }
    })
    return () => {
      active = false
      unsub()
    }
  }, [loadPreferencesFn, subscribePreferencesFn])

  const isEnabled = preferences !== null ? preferences.enabled : false
  const isEnabledRef = useRef(isEnabled)
  isEnabledRef.current = isEnabled
  const persistEnabled = preferences?.persistEnabled === true
  const keepWhenNoHost = preferences?.keepWhenNoHost === true
  const keepHostConnection = preferences?.keepHostConnection === true
  const persistEnabledRef = useRef(persistEnabled)
  persistEnabledRef.current = persistEnabled
  const keepWhenNoHostRef = useRef(keepWhenNoHost)
  keepWhenNoHostRef.current = keepWhenNoHost
  const keepHostConnectionRef = useRef(keepHostConnection)
  keepHostConnectionRef.current = keepHostConnection
  const captionsEnabled = preferences?.captionsEnabled === true

  const isAndroid = options?.isAndroid ?? Platform.OS === 'android'

  useEffect(() => {
    if (preferences === null || !isAndroid) {
      return
    }
    void syncPetSpeechPersistSettings(preferences)
  }, [preferences, isAndroid])

  const ensureNotificationPermissionsFn =
    options?.ensureNotificationPermissions ?? defaultEnsureNotificationPermissions

  const defaultAdapter = useMemo(
    () => (isAndroid ? getPetSpeechNativeAdapter() : null),
    [isAndroid]
  )

  const acquireVoiceSessionProp = options?.acquireVoiceSession
  const releaseVoiceSessionProp = options?.releaseVoiceSession
  const updateVoiceSessionNotificationProp = options?.updateVoiceSessionNotification
  const handlerOptionsProp = options?.handlerOptions

  const effectiveHandlerOptions = useMemo<PetSpeakHandlerOptions>(() => {
    const userOnCaption = handlerOptionsProp?.onCaption
    return {
      prepareEvent: preparePetSpeakEvent,
      ...handlerOptionsProp,
      onCaption: (caption) => {
        userOnCaption?.(caption)
        onCaptionChange?.(caption)
      }
    }
  }, [handlerOptionsProp, onCaptionChange])

  const acquireVoiceSessionFn = useCallback(
    () =>
      acquireVoiceSessionProp
        ? acquireVoiceSessionProp()
        : (defaultAdapter?.acquireVoiceSession?.() ?? Promise.resolve({ held: false })),
    [acquireVoiceSessionProp, defaultAdapter]
  )
  const releaseVoiceSessionFn = useCallback(
    () =>
      releaseVoiceSessionProp
        ? releaseVoiceSessionProp()
        : (defaultAdapter?.releaseVoiceSession?.() ?? Promise.resolve()),
    [releaseVoiceSessionProp, defaultAdapter]
  )
  const updateVoiceSessionNotificationFn = useCallback(
    (text: string) =>
      updateVoiceSessionNotificationProp
        ? updateVoiceSessionNotificationProp(text)
        : (defaultAdapter?.updateVoiceSessionNotification?.(text) ?? Promise.resolve()),
    [updateVoiceSessionNotificationProp, defaultAdapter]
  )

  const holdStateRef = useRef(idlePetVoiceHoldState())
  const graceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refreshCatalog = useCallback(() => {
    const generation = ++catalogGenerationRef.current
    void loadCatalogFn()
      .then((entries) => {
        if (isDisposedRef.current || generation !== catalogGenerationRef.current) {
          return
        }
        const profiles = selectConnectableHostProfiles(entries ?? [])
        primeHosts(profiles)
        setConnectableProfiles(profiles)
      })
      .catch(() => {})
  }, [loadCatalogFn, primeHosts])

  useEffect(() => {
    isDisposedRef.current = false
    refreshCatalog()
    const unsubscribeAll = subscribeToCatalogChange(refreshCatalog)
    return () => {
      isDisposedRef.current = true
      unsubscribeAll()
    }
  }, [refreshCatalog, subscribeToCatalogChange])

  const hostIds = useMemo(() => connectableProfiles.map((h) => h.id), [connectableProfiles])

  const clients = useAllHostClients(hostIds)

  const subscriptionsRef = useRef<Map<string, PetSpeakSubscriptionEntry>>(new Map())
  const hostStatesRef = useRef<Map<string, ConnectionState>>(new Map())
  const speechStatesRef = useRef<PetVoiceHoldRuntime['speechStates']>(new Map())
  const retryTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const retryAttemptsRef = useRef<Map<string, number>>(new Map())
  const holdRuntimeRef = useRef<PetVoiceHoldRuntime | null>(null)
  const retainPrefsReadyRef = useRef(false)

  useEffect(() => {
    return wirePetSpeakHostClients({
      isAndroid,
      isEnabled,
      isDisposed: () => isDisposedRef.current,
      isEnabledNow: () => isEnabledRef.current,
      holdState: holdStateRef,
      graceTimer: graceTimerRef,
      currentSubs: subscriptionsRef.current,
      hostStates: hostStatesRef.current,
      speechStates: speechStatesRef.current,
      retryTimers: retryTimersRef.current,
      retryAttempts: retryAttemptsRef.current,
      holdRuntimeRef,
      ensureNotificationPermissions: ensureNotificationPermissionsFn,
      acquireVoiceSession: acquireVoiceSessionFn,
      releaseVoiceSession: releaseVoiceSessionFn,
      updateVoiceSessionNotification: updateVoiceSessionNotificationFn,
      persistEnabled: () => persistEnabledRef.current,
      keepWhenNoHost: () => keepWhenNoHostRef.current,
      keepHostConnection: () => keepHostConnectionRef.current,
      handlerOptions: effectiveHandlerOptions,
      clients,
      preferences
    })
  }, [
    clients,
    isEnabled,
    effectiveHandlerOptions,
    isAndroid,
    ensureNotificationPermissionsFn,
    acquireVoiceSessionFn,
    releaseVoiceSessionFn,
    updateVoiceSessionNotificationFn,
    persistEnabled,
    keepWhenNoHost,
    keepHostConnection,
    preferences
  ])

  useEffect(() => {
    if (holdRuntimeRef.current === null) {
      return
    }
    if (!retainPrefsReadyRef.current) {
      retainPrefsReadyRef.current = true
      return
    }
    evaluatePetVoiceHold(holdRuntimeRef.current)
  }, [keepHostConnection, persistEnabled, keepWhenNoHost, isEnabled])

  // Root unmount cleanup
  useEffect(() => {
    return () => {
      clearPetVoiceGraceTimer(graceTimerRef)
      for (const timer of retryTimersRef.current.values()) {
        clearTimeout(timer)
      }
      retryTimersRef.current.clear()
      retryAttemptsRef.current.clear()
      for (const sub of subscriptionsRef.current.values()) {
        sub.unsub()
      }
      subscriptionsRef.current.clear()
      hostStatesRef.current.clear()
      speechStatesRef.current.clear()
      setHostConnectionRetainRuntime(false)
      if (holdStateRef.current.isSessionHeld) {
        holdStateRef.current = idlePetVoiceHoldState()
        void releaseVoiceSessionFn()
      }
    }
  }, [releaseVoiceSessionFn])

  return captionsEnabled
}

export function PetSpeakRootBridge(props?: PetSpeakBridgeOptions): ReactElement | null {
  const [internalCaption, setInternalCaption] = useState<PetSpeakCaption | null>(null)
  const [localLiveCaption, setLocalLiveCaption] = useState<PetSpeakCaption | null>(() =>
    getPetSpeakLiveCaption()
  )
  const [previewCaption, setPreviewCaption] = useState<PetSpeakCaption | null>(() =>
    getPetSpeakCaptionPreview()
  )
  const [highlightRange, setHighlightRange] = useState<PetSpeakCaptionRangeEvent | null>(null)
  const prefCaptionsEnabled = usePetSpeakRootBridge(props, setInternalCaption)

  useEffect(() => {
    const unsub = subscribePetSpeakCaptionPreview((caption) => {
      setPreviewCaption(caption)
    })
    return unsub
  }, [])

  useEffect(() => {
    const unsub = subscribePetSpeakLiveCaption((caption) => {
      setLocalLiveCaption(caption)
    })
    return unsub
  }, [])

  useEffect(() => {
    attachNativeCaptionRangeListener()
    const unsub = subscribePetSpeakCaptionRange(setHighlightRange)
    return unsub
  }, [])

  const captionsOn =
    props?.captionsEnabled !== undefined ? props.captionsEnabled : prefCaptionsEnabled
  const liveCaption =
    localLiveCaption ?? (props?.caption !== undefined ? props.caption : internalCaption)
  const activeCaption = previewCaption ?? (captionsOn ? liveCaption : null)

  if (!activeCaption) {
    return null
  }

  const isPreview = previewCaption !== null
  const karaokeRange =
    highlightRange && highlightRange.eventId === activeCaption.eventId ? highlightRange : null

  return (
    <PetSpeakCaptionHud
      caption={activeCaption}
      highlightRange={karaokeRange}
      onDisable={() => {
        applyPetSpeakCaptionRange(null)
        if (isPreview) {
          hidePetSpeakCaptionPreview()
        }
        if (captionsOn) {
          void setPetSpeechCaptionsEnabled(false)
        }
      }}
    />
  )
}
