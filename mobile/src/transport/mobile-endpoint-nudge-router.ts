import type { RelayReconnectController } from './mobile-relay-reconnect-controller'
import type { StableLogicalRpcClient } from './stable-logical-rpc-client'
import type { ForegroundNudgeReason } from './types'

// Routes attention/network nudges: focus and app-resume probe a healthy relay,
// a network change replaces it make-before-break, everything else re-enters recovery.
export class MobileEndpointNudgeRouter {
  constructor(
    private readonly args: {
      logical: StableLogicalRpcClient
      controller: RelayReconnectController
      isStopped: () => boolean
      isForeground: () => boolean
      shouldRetainHostConnection?: () => boolean
      setForeground: (foreground: boolean) => void
      replaceRelay: () => void
      scheduleDirectProbe: () => void
    }
  ) {}

  nudge(reason: ForegroundNudgeReason): void {
    const { args } = this
    if (args.isStopped()) {
      return
    }
    if (!args.isForeground()) {
      // Why: persist FGS / expo-router focus can nudge after Home while the
      // activity is already paused. Faking foreground here cancelled the 30s
      // relay grace on A35. AppState is the only visibility signal.
      // Keep-host retain may revive without pretending the UI is foreground.
      if (!args.shouldRetainHostConnection?.()) {
        return
      }
    }
    const verdict = args.controller.handleActiveNudge(args.logical, reason)
    if (verdict === 'replace') {
      args.replaceRelay()
    }
    args.scheduleDirectProbe()
  }
}
