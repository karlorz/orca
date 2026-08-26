import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Platform } from 'react-native'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState, HostCatalogEntry, HostProfile } from '../transport/types'
import { loadHostCatalog } from '../transport/host-store'
import { selectConnectableHostProfiles } from '../transport/host-catalog-selection'
import { useAllHostClients } from '../transport/use-all-host-clients'
import { useRpcClientContext } from '../transport/client-context'
import { subscribeToPetSpeak } from './pet-speak-subscription'
import type { PetSpeakHandlerOptions } from './pet-speak-types'
import { getPetSpeechNativeAdapter } from './pet-speak-native-adapter'
import { ensureNotificationPermissions as defaultEnsureNotificationPermissions } from '../notifications/notification-permissions'
import {
  decidePetVoiceHoldAction,
  PET_VOICE_RECONNECT_GRACE_MS,
  type PetVoiceHoldState
} from './pet-voice-hold-decision'

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
}

export function usePetSpeakRootBridge(options?: PetSpeakBridgeOptions): void {
  const ctx = useRpcClientContext()
  const [connectableProfiles, setConnectableProfiles] = useState<HostProfile[]>([])
  const loadCatalogFn = options?.loadCatalog ?? loadHostCatalog
  const subscribeToCatalogChange = options?.subscribeToCatalogChange ?? ctx.subscribeAllHosts
  const primeHosts = ctx.primeHosts
  const catalogGenerationRef = useRef(0)
  const isDisposedRef = useRef(false)

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

  const holdStateRef = useRef<PetVoiceHoldState>({
    isSessionHeld: false,
    isAcquiring: false,
    reconnectingSince: null,
    lastNotificationText: null
  })
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

  const subscriptionsRef = useRef<Map<string, { client: RpcClient; unsub: () => void }>>(new Map())
  const hostStatesRef = useRef<Map<string, ConnectionState>>(new Map())

  // Wire per client onStateChange
  useEffect(() => {
    const currentSubs = subscriptionsRef.current
    const hostStates = hostStatesRef.current

    const clearGraceTimer = () => {
      if (graceTimerRef.current !== null) {
        clearTimeout(graceTimerRef.current)
        graceTimerRef.current = null
      }
    }

    const evaluateHoldDecision = (now: number = Date.now()) => {
      if (!isAndroid || isDisposedRef.current) {
        return
      }

      const connectedCount = currentSubs.size
      let reconnectingCount = 0
      for (const state of hostStates.values()) {
        if (state === 'reconnecting') {
          reconnectingCount++
        }
      }

      const action = decidePetVoiceHoldAction({
        state: holdStateRef.current,
        connectedCount,
        reconnectingCount,
        now
      })

      holdStateRef.current = action.nextState

      if (action.type === 'acquire') {
        clearGraceTimer()
        void ensureNotificationPermissionsFn().then((granted) => {
          if (granted && !isDisposedRef.current && subscriptionsRef.current.size > 0) {
            void acquireVoiceSessionFn().then((res) => {
              if (isDisposedRef.current) return
              if (res.held && subscriptionsRef.current.size > 0) {
                holdStateRef.current = {
                  ...holdStateRef.current,
                  isSessionHeld: true,
                  isAcquiring: false,
                  reconnectingSince: null,
                  lastNotificationText: action.notificationText
                }
              } else {
                holdStateRef.current = {
                  ...holdStateRef.current,
                  isSessionHeld: false,
                  isAcquiring: false,
                  reconnectingSince: null,
                  lastNotificationText: null
                }
                if (res.held) {
                  void releaseVoiceSessionFn()
                }
              }
            })
          } else {
            holdStateRef.current = {
              ...holdStateRef.current,
              isAcquiring: false
            }
          }
        })
      } else if (action.type === 'update-notification') {
        if (action.nextState.reconnectingSince !== null) {
          if (graceTimerRef.current === null) {
            const remaining = Math.max(
              0,
              PET_VOICE_RECONNECT_GRACE_MS - (now - action.nextState.reconnectingSince)
            )
            graceTimerRef.current = setTimeout(() => {
              graceTimerRef.current = null
              evaluateHoldDecision(Date.now())
            }, remaining)
          }
        } else {
          clearGraceTimer()
        }
        void updateVoiceSessionNotificationFn(action.notificationText)
      } else if (action.type === 'release') {
        clearGraceTimer()
        void releaseVoiceSessionFn()
      } else {
        // action.type === 'none'
        if (action.nextState.reconnectingSince === null) {
          clearGraceTimer()
        }
      }
    }

    const cleanups = clients.map((entry) => {
      const wireUp = (state: ConnectionState) => {
        hostStates.set(entry.hostId, state)
        if (state === 'connected') {
          if (
            !currentSubs.has(entry.hostId) ||
            currentSubs.get(entry.hostId)?.client !== entry.client
          ) {
            currentSubs.get(entry.hostId)?.unsub()
            const unsub = subscribeToPetSpeak(entry.client, handlerOptionsProp)
            currentSubs.set(entry.hostId, { client: entry.client, unsub })
            evaluateHoldDecision()
          }
        } else {
          const sub = currentSubs.get(entry.hostId)
          if (sub && sub.client === entry.client) {
            sub.unsub()
            currentSubs.delete(entry.hostId)
            evaluateHoldDecision()
          }
        }
      }

      wireUp(entry.state)
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
      evaluateHoldDecision()
    }

    return () => {
      for (const cleanup of cleanups) {
        cleanup()
      }
    }
  }, [
    clients,
    handlerOptionsProp,
    isAndroid,
    ensureNotificationPermissionsFn,
    acquireVoiceSessionFn,
    releaseVoiceSessionFn,
    updateVoiceSessionNotificationFn
  ])

  // Root unmount cleanup
  useEffect(() => {
    return () => {
      if (graceTimerRef.current !== null) {
        clearTimeout(graceTimerRef.current)
        graceTimerRef.current = null
      }
      for (const sub of subscriptionsRef.current.values()) {
        sub.unsub()
      }
      subscriptionsRef.current.clear()
      hostStatesRef.current.clear()
      if (holdStateRef.current.isSessionHeld) {
        holdStateRef.current = {
          isSessionHeld: false,
          isAcquiring: false,
          reconnectingSince: null,
          lastNotificationText: null
        }
        void releaseVoiceSessionFn()
      }
    }
  }, [releaseVoiceSessionFn])
}

export function PetSpeakRootBridge(props?: PetSpeakBridgeOptions): null {
  usePetSpeakRootBridge(props)
  return null
}
