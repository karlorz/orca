import {
  AppState,
  NativeEventEmitter,
  NativeModules,
  Platform,
  TurboModuleRegistry,
  type AppStateStatus
} from 'react-native'

type NativeAppStateModule = {
  addListener: (eventName: string) => void
  removeListeners: (count: number) => void
  getCurrentAppState?: (
    success: (appState: { app_state: string }) => void,
    error: (error: unknown) => void
  ) => void
}

function nativeAppStateModule(): NativeAppStateModule | null {
  const turbo = TurboModuleRegistry.get('AppState') as NativeAppStateModule | null
  if (turbo && typeof turbo.addListener === 'function') {
    return turbo
  }
  const legacy = NativeModules.AppState as NativeAppStateModule | undefined
  if (legacy && typeof legacy.addListener === 'function') {
    return legacy
  }
  return null
}

function isActiveState(state: string | null | undefined): boolean {
  return state === 'active'
}

// RN 0.83 AppState.js constructs NativeEventEmitter(null) on Android, so the
// native module never receives addListener and pause events never reach JS.
// Bind the native emitter ourselves. That is what arms the 30s relay grace.
export function subscribeAppVisibility(onActive: (active: boolean) => void): () => void {
  onActive(isActiveState(AppState.currentState))

  const publicSub = AppState.addEventListener('change', (state: AppStateStatus) => {
    onActive(isActiveState(state))
  })

  let nativeSub: { remove(): void } | undefined
  let poll: ReturnType<typeof setInterval> | undefined
  if (Platform.OS === 'android') {
    const native = nativeAppStateModule()
    if (native) {
      const applyNative = (data: { app_state?: string } | string) => {
        const state = typeof data === 'string' ? data : data?.app_state
        onActive(isActiveState(state))
      }
      const emitter = new NativeEventEmitter(native)
      nativeSub = emitter.addListener('appStateDidChange', applyNative)
      const readCurrent = () => {
        native.getCurrentAppState?.(applyNative, () => {})
      }
      readCurrent()
      // Why: bridgeless can skip the JS change event; a local read still
      // arms the 30s relay grace. This is not a radio keepalive.
      poll = setInterval(readCurrent, 2000)
    }
  }

  return () => {
    publicSub.remove()
    nativeSub?.remove()
    if (poll !== undefined) {
      clearInterval(poll)
    }
  }
}
