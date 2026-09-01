import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Platform } from 'react-native'
import type { ConnectionState, HostCatalogEntry, HostProfile } from '../transport/types'
import { loadHostCatalog } from '../transport/host-store'
import { selectConnectableHostProfiles } from '../transport/host-catalog-selection'
import { useAllHostClients } from '../transport/use-all-host-clients'
import { useRpcClientContext } from '../transport/client-context'
import { subscribeToPetSpeak } from './pet-speak-subscription'
import type { PetSpeakCaption, PetSpeakHandlerOptions } from './pet-speak-types'
import { getPetSpeechNativeAdapter } from './pet-speak-native-adapter'
import { ensureNotificationPermissions as defaultEnsureNotificationPermissions } from '../notifications/notification-permissions'
import {
  loadPetSpeechPreferences,
  setPetSpeechCaptionsEnabled,
  subscribePetSpeechPreferences,
  type PetSpeechPreferences
} from './pet-speech-preferences'
import { PetSpeakCaptionHud } from './pet-speak-caption-hud'
import { buildPetSpeechDeviceStatus } from './pet-speech-device-status'
import { preparePetSpeakEvent } from './pet-speech-service'
import {
  clearPetVoiceGraceTimer,
  evaluatePetVoiceHold,
  idlePetVoiceHoldState,
  type PetSpeakSubscriptionEntry,
  type PetVoiceHoldRuntime
} from './pet-speak-root-bridge-hold'

export { PET_VOICE_RECONNECT_GRACE_MS } from './pet-voice-hold-decision'

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
  const captionsEnabled = preferences?.captionsEnabled === true

  const isAndroid = options?.isAndroid ?? Platform.OS === 'android'
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

  useEffect(() => {
    const currentSubs = subscriptionsRef.current
    const hostStates = hostStatesRef.current
    const holdRuntime: PetVoiceHoldRuntime = {
      isAndroid,
      isDisposed: () => isDisposedRef.current,
      holdState: holdStateRef,
      graceTimer: graceTimerRef,
      currentSubs,
      hostStates,
      ensureNotificationPermissions: ensureNotificationPermissionsFn,
      acquireVoiceSession: acquireVoiceSessionFn,
      releaseVoiceSession: releaseVoiceSessionFn,
      updateVoiceSessionNotification: updateVoiceSessionNotificationFn
    }

    if (!isEnabled) {
      clearPetVoiceGraceTimer(graceTimerRef)
      for (const sub of currentSubs.values()) {
        sub.unsub()
      }
      currentSubs.clear()
      if (holdStateRef.current.isSessionHeld) {
        holdStateRef.current = idlePetVoiceHoldState()
        void releaseVoiceSessionFn()
      }
      for (const entry of clients) {
        if (entry.client.getState() === 'connected') {
          void buildPetSpeechDeviceStatus({ preferences: preferences ?? undefined })
            .then((status) => {
              if (entry.client.getState() === 'connected') {
                entry.client.sendRequest('pet.speak.status', status).catch(() => {})
              }
            })
            .catch(() => {})
        }
      }
      return
    }

    const cleanups = clients.map((entry) => {
      const wireUp = (state: ConnectionState) => {
        const previous = hostStates.get(entry.hostId)
        hostStates.set(entry.hostId, state)
        let subscriptionChanged = false
        if (state === 'connected' && isEnabled) {
          if (
            !currentSubs.has(entry.hostId) ||
            currentSubs.get(entry.hostId)?.client !== entry.client
          ) {
            currentSubs.get(entry.hostId)?.unsub()
            const unsub = subscribeToPetSpeak(entry.client, effectiveHandlerOptions, entry.hostId)
            currentSubs.set(entry.hostId, { client: entry.client, unsub })
            subscriptionChanged = true
          }
        } else {
          const sub = currentSubs.get(entry.hostId)
          if (sub && sub.client === entry.client) {
            sub.unsub()
            currentSubs.delete(entry.hostId)
            subscriptionChanged = true
          }
        }
        if (previous !== state || subscriptionChanged) {
          evaluatePetVoiceHold(holdRuntime)
        }
      }

      wireUp(entry.client.getState())
      return entry.client.onStateChange(wireUp)
    })

    // Also sweep removed hosts
    const activeHostIds = new Set(clients.map((c) => c.hostId))
    let removedAny = false
    for (const [hostId, sub] of Array.from(currentSubs.entries())) {
      if (!activeHostIds.has(hostId)) {
        sub.unsub()
        currentSubs.delete(hostId)
        removedAny = true
      }
    }
    for (const hostId of Array.from(hostStates.keys())) {
      if (!activeHostIds.has(hostId)) {
        hostStates.delete(hostId)
        removedAny = true
      }
    }
    if (removedAny) {
      evaluatePetVoiceHold(holdRuntime)
    }

    return () => {
      for (const cleanup of cleanups) {
        cleanup()
      }
    }
  }, [
    clients,
    isEnabled,
    effectiveHandlerOptions,
    isAndroid,
    ensureNotificationPermissionsFn,
    acquireVoiceSessionFn,
    releaseVoiceSessionFn,
    updateVoiceSessionNotificationFn
  ])

  // Root unmount cleanup
  useEffect(() => {
    return () => {
      clearPetVoiceGraceTimer(graceTimerRef)
      for (const sub of subscriptionsRef.current.values()) {
        sub.unsub()
      }
      subscriptionsRef.current.clear()
      hostStatesRef.current.clear()
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
  const prefCaptionsEnabled = usePetSpeakRootBridge(props, setInternalCaption)

  const captionsOn =
    props?.captionsEnabled !== undefined ? props.captionsEnabled : prefCaptionsEnabled
  const activeCaption = captionsOn
    ? props?.caption !== undefined
      ? props.caption
      : internalCaption
    : null

  if (!activeCaption) {
    return null
  }

  return (
    <PetSpeakCaptionHud
      caption={activeCaption}
      onDisable={() => {
        void setPetSpeechCaptionsEnabled(false)
      }}
    />
  )
}
