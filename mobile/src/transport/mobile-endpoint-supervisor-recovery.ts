import {
  persistRelayHost,
  suspendRelayIfStillConnected
} from './mobile-endpoint-supervisor-support'
import type { MobileEndpointSupervisorDependencies } from './mobile-endpoint-supervisor-contract'
import type { MobileRelayCredentialBundle } from './mobile-relay-credential-bundle'
import { selectDialableRelayCredentials } from './mobile-relay-credential-selection'
import {
  mobileRelayCredentialNeedsRotation,
  rotateMobileRelayCredential
} from './mobile-relay-credential-rotation'
import { logRelayCredentialUnavailable } from './mobile-relay-diagnostic-log'
import type { RelayLeaseRotationTimer } from './mobile-relay-lease-rotation-timer'
import type { RelayReconnectController } from './mobile-relay-reconnect-controller'
import * as recoveryPresentation from './mobile-relay-recovery-presentation'
import type { RelayRecoveryLog } from './mobile-relay-recovery-log'
import type { MobileRelaySessionEstablisher } from './mobile-relay-session-establisher'
import type { StableLogicalRpcClient } from './stable-logical-rpc-client'
import type { HostProfile } from './types'

export type SupervisorRecoveryContext = {
  isActive: () => boolean
  host: () => HostProfile
  setHost: (host: HostProfile) => void
  bundle: () => MobileRelayCredentialBundle | null
  setBundle: (bundle: MobileRelayCredentialBundle | null) => void
  operationInFlight: () => boolean
  setOperationInFlight: (value: boolean) => void
  pendingReplace: () => boolean
  setPendingReplace: (value: boolean) => void
  relayRotationPending: () => boolean
  stopped: () => boolean
  credentialRotationInFlight: () => boolean
  setCredentialRotationInFlight: (value: boolean) => void
  logical: StableLogicalRpcClient
  relayReconnect: RelayReconnectController
  dependencies: MobileEndpointSupervisorDependencies
  logRelay: RelayRecoveryLog
  sessionEstablisher: MobileRelaySessionEstablisher
  leaseRotation: RelayLeaseRotationTimer
  recoverRelay: (forceReplacement?: boolean, ownsRecovery?: boolean) => Promise<void>
}

export async function recoverMobileRelay(
  ctx: SupervisorRecoveryContext,
  forceReplacement = false,
  ownsRecovery = false
): Promise<void> {
  if (!ctx.isActive() || !ctx.host().relay) {
    return
  }
  if (ctx.operationInFlight()) {
    // Why: a 12s direct probe can own the mutex when a network handoff lands;
    // afterProbe replays the queued replacement so the signal is never lost.
    ctx.setPendingReplace(ctx.pendingReplace() || (forceReplacement && ownsRecovery))
    return
  }
  if (ctx.pendingReplace()) {
    ctx.setPendingReplace(false)
    forceReplacement = true
    ownsRecovery = true
  }
  // Why: connecting/handshaking is live direct progress; an unforced relay dial
  // would race it before the grace timer has given direct its head start.
  if (!forceReplacement && !ctx.relayReconnect.needsRecovery(ctx.logical.getState())) {
    return
  }
  // Why: revival and lease timers can overlap resume failures; one shared cooldown
  // prevents PEER_DROPPED/LIMIT_EXCEEDED reconnect churn.
  if (ctx.relayReconnect.shouldDefer()) {
    if (ownsRecovery) {
      // Why: never tear down a session no dial has disproven — the intent stays
      // queued so the armed retry runs forced once the cooldown lapses.
      ctx.setPendingReplace(true)
    }
    ctx.logRelay('recovery deferred by cooldown or gate')
    return
  }
  ctx.setOperationInFlight(true)
  let retryAfterOperation = false
  try {
    const selection = await selectDialableRelayCredentials({
      bundle: ctx.bundle(),
      controller: ctx.relayReconnect,
      readBundle: () => ctx.dependencies.readBundle(ctx.host().id),
      onAdoptedFresherBundle: () => ctx.logRelay('adopted fresher durable credential bundle')
    })
    ctx.setBundle(selection.bundle)
    if (selection.credentials.length === 0) {
      ctx.logical.setRecoveryPath(null)
      // Why: "expired" vs "missing" separates a sleep-past-expiry phone
      // (needs re-pair or LAN) from a Keychain failure in field reports.
      logRelayCredentialUnavailable(ctx.logRelay, selection.bundle !== null)
      ctx.relayReconnect.armCredentialReprobe()
      if (ownsRecovery) {
        // Why: no dial happened — keep the session and the intent; the reprobe
        // runs forced and replaces make-before-break once a credential exists.
        ctx.setPendingReplace(true)
      }
      return
    }
    const recoveryNeeded =
      forceReplacement || ctx.relayReconnect.needsRecovery(ctx.logical.getState())
    if (!ctx.isActive() || !recoveryNeeded) {
      return
    }
    ctx.logical.setRecoveryPath('relay', ctx.relayReconnect.getFailureCount())
    const dialed = await ctx.sessionEstablisher.dialEligible(selection.credentials)
    if (dialed.outcome === 'established') {
      // Why: a fresh socket satisfies any replacement intent queued mid-dial.
      ctx.setPendingReplace(false)
      retryAfterOperation = ctx.logical.getState() !== 'connected'
      return
    }
    if (dialed.outcome === 'aborted') {
      ctx.logical.setRecoveryPath(null)
      // Why: direct won the race or the supervisor went inactive — not a
      // failure; booking backoff would delay the next genuine recovery.
      return
    }
    // Why: cleanup may happen while a relay dial is awaiting the network;
    // record its outcome without recreating a foreground retry timer.
    const scheduleRetry = (!forceReplacement || ownsRecovery) && ctx.isActive()
    ctx.relayReconnect.registerFailure(dialed.error, scheduleRetry)
    recoveryPresentation.clearIfCredentialBlocked(ctx.logical, ctx.relayReconnect)
    if (ownsRecovery) {
      suspendRelayIfStillConnected(ctx.relayReconnect, ctx.logical)
    }
  } finally {
    ctx.setOperationInFlight(false)
    if (forceReplacement && ctx.relayRotationPending() && ctx.isActive()) {
      ctx.leaseRotation.armRetry(ctx.relayReconnect.retryDelayMs(5000))
    }
    // Why: the active relay can drop while migration follow-up still owns the mutex.
    if (retryAfterOperation && ctx.isActive()) {
      void ctx.recoverRelay()
    }
  }
}

export async function rotateMobileRelayCredentialIfNeeded(
  ctx: SupervisorRecoveryContext,
  force = false
): Promise<void> {
  const bundle = ctx.bundle()
  if (
    ctx.stopped() ||
    ctx.credentialRotationInFlight() ||
    !bundle ||
    ctx.logical.getActivePath() === 'relay' ||
    (!force && !mobileRelayCredentialNeedsRotation(bundle, ctx.dependencies.now()))
  ) {
    return
  }
  ctx.setCredentialRotationInFlight(true)
  let credentialRefreshed = false
  try {
    const result = await rotateMobileRelayCredential({
      client: ctx.logical,
      bundle,
      writeBundle: ctx.dependencies.writeBundle,
      randomBytes: ctx.dependencies.randomBytes
    })
    ctx.setBundle(result.bundle)
    // Why: a scheduled rotation can finish after the old credential enters the rejection gate.
    credentialRefreshed = true
    ctx.setHost(await persistRelayHost(ctx.host(), result.relay, ctx.dependencies.saveHost))
  } catch {
    // Why: pending material remains durable; the next authenticated direct
    // opportunity must reconcile it before creating another install key.
  } finally {
    if (credentialRefreshed) {
      ctx.relayReconnect.completeCredentialRefresh()
    }
    ctx.setCredentialRotationInFlight(false)
    if (
      credentialRefreshed &&
      ctx.isActive() &&
      ctx.relayReconnect.needsRecovery(ctx.logical.getState())
    ) {
      void ctx.recoverRelay()
    }
  }
}
