import { useCallback, useEffect, useRef, type RefObject } from 'react'
import { AppState, Platform } from 'react-native'

// Why: if the document dies before the glue can post anything (or the RN
// message bridge never comes up), no webview error and no native handler
// fires — without a native watchdog that failure is a silent blank pane.
// Android inlines ~730KB of xterm into loadData; cheap WebViews can still
// be parsing past 15s, so give them longer before painting the overlay.
function webReadyWatchdogMs(): number {
  return Platform.OS === 'android' ? 30000 : 15000
}

export function useTerminalWebReadyWatchdog(
  isWebReadyRef: RefObject<boolean>,
  reportEngineError: (message: string, fatal: boolean) => void
) {
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearWebReadyWatchdog = useCallback(() => {
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current)
      watchdogRef.current = null
    }
  }, [])

  const armWebReadyWatchdog = useCallback(() => {
    clearWebReadyWatchdog()
    const fire = () => {
      watchdogRef.current = null
      if (isWebReadyRef.current) {
        return
      }
      if (AppState.currentState !== 'active') {
        // Why: backgrounded WebViews legitimately stall; only judge foreground loads.
        watchdogRef.current = setTimeout(fire, webReadyWatchdogMs())
        return
      }
      reportEngineError(
        'Terminal did not initialize - no ready signal from the terminal view',
        true
      )
    }
    watchdogRef.current = setTimeout(fire, webReadyWatchdogMs())
  }, [clearWebReadyWatchdog, isWebReadyRef, reportEngineError])

  useEffect(() => {
    armWebReadyWatchdog()
    return clearWebReadyWatchdog
  }, [armWebReadyWatchdog, clearWebReadyWatchdog])

  return { armWebReadyWatchdog, clearWebReadyWatchdog }
}
