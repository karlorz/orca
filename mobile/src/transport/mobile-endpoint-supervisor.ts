import type { MobileEndpointSupervisorDependencies } from './mobile-endpoint-supervisor-contract'
import { DirectReturnProbe } from './mobile-direct-return-probe'
import { RelayReconnectController } from './mobile-relay-reconnect-controller'
import { RelayLeaseRotationTimer } from './mobile-relay-lease-rotation-timer'
import { MobileEndpointHysteresis } from './mobile-endpoint-hysteresis'
import { liveRelayLeaseExpiry } from './mobile-endpoint-supervisor-support'
import {
  recoverMobileRelay,
  rotateMobileRelayCredentialIfNeeded,
  type SupervisorRecoveryContext
} from './mobile-endpoint-supervisor-recovery'
import { createRelayRecoveryLog, type RelayRecoveryLog } from './mobile-relay-recovery-log'
import type { MobileRelayCredentialBundle } from './mobile-relay-credential-bundle'
import { MobileEndpointNudgeRouter } from './mobile-endpoint-nudge-router'
import { MobileRelayDirectGraceTimer } from './mobile-relay-direct-grace-timer'
import { MobileRelaySessionEstablisher } from './mobile-relay-session-establisher'
import * as recoveryPresentation from './mobile-relay-recovery-presentation'
import type { StableLogicalRpcClient } from './stable-logical-rpc-client'
import type { ForegroundNudgeReason } from './types'
import type { MobileRelayEndpoint } from '../../../src/shared/mobile-relay-credential-contract'
import { MobileRelayBackgroundGrace } from './mobile-relay-background-grace'
import {
  getHostConnectionRetainRuntime,
  subscribeHostConnectionRetainRuntime
} from '../pet-speak/host-connection-retain'
import { logRelayConnected, logRelayDialFailure } from './mobile-relay-diagnostic-log'

export type { MobileEndpointSupervisorDependencies } from './mobile-endpoint-supervisor-contract'

const DIRECT_OBSERVATION_MS = 30_000
const MINIMUM_DWELL_MS = 60_000
const FAILURE_COOLDOWN_MS = 60_000

export class MobileEndpointSupervisor {
  private bundle: MobileRelayCredentialBundle | null = null
  private stopped = false
  private operationInFlight = false
  private pendingReplace = false
  private readonly nudgeRouter: MobileEndpointNudgeRouter
  private credentialRotationInFlight = false
  private relayRotationPending = false
  private unsubscribeState: (() => void) | null = null
  private readonly hysteresis: MobileEndpointHysteresis
  private readonly relayReconnect: RelayReconnectController
  private readonly leaseRotation: RelayLeaseRotationTimer
  private readonly logRelay: RelayRecoveryLog
  private readonly directProbe: DirectReturnProbe
  private readonly directGrace: MobileRelayDirectGraceTimer
  private readonly backgroundGrace: MobileRelayBackgroundGrace
  private readonly sessionEstablisher: MobileRelaySessionEstablisher
  private readonly unsubscribeRetain: () => void

  constructor(
    private readonly logical: StableLogicalRpcClient,
    private readonly hostId: string,
    relay: MobileRelayEndpoint,
    private readonly dependencies: MobileEndpointSupervisorDependencies
  ) {
    this.hysteresis = new MobileEndpointHysteresis(dependencies.now(), {
      directSuccessesRequired: 3,
      directObservationMs: DIRECT_OBSERVATION_MS,
      failureCooldownMs: FAILURE_COOLDOWN_MS,
      minimumDwellMs: MINIMUM_DWELL_MS
    })
    this.logRelay = createRelayRecoveryLog(dependencies.now, dependencies.onLog)
    this.relayReconnect = new RelayReconnectController(dependencies, this.recoverRelay.bind(this))
    this.relayReconnect.reportRecoveryTo(logical)
    this.nudgeRouter = new MobileEndpointNudgeRouter({
      logical,
      controller: this.relayReconnect,
      isStopped: () => this.stopped,
      isForeground: () => this.backgroundGrace.isForeground(),
      shouldRetainHostConnection: () => this.backgroundGrace.isRetainingHostConnection(),
      setForeground: (foreground) => this.setForeground(foreground),
      replaceRelay: () => void this.recoverRelay(true, true),
      scheduleDirectProbe: () => this.directProbe.schedule(0)
    })
    this.leaseRotation = new RelayLeaseRotationTimer(dependencies, () => {
      this.relayRotationPending = true
      void this.recoverRelay(true)
    })
    // Why: the race owns recovery exactly like a network-change replacement — its
    // failure must book the shared cooldown. recoverRelay's own guards already
    // cover stopped/background/no-relay, so the timer needs no scope check.
    this.directGrace = new MobileRelayDirectGraceTimer(dependencies, logical, () => {
      void this.recoverRelay(true, true)
    })
    this.sessionEstablisher = new MobileRelaySessionEstablisher({
      logical,
      controller: this.relayReconnect,
      openRelay: dependencies.openRelay,
      randomBytes: dependencies.randomBytes,
      writeBundle: dependencies.writeBundle,
      isActive: () => this.isActive(),
      isForeground: () => this.backgroundGrace.isForeground(),
      isRetainingHostConnection: () => this.backgroundGrace.isRetainingHostConnection(),
      isStopped: () => this.stopped,
      hostId,
      relay,
      resolveRelay: dependencies.resolveRelay,
      setRelayRouting: dependencies.setRelayRouting,
      bundle: () => this.bundle,
      adoptBundle: (bundle) => (this.bundle = bundle),
      recordMigration: () => {
        this.relayRotationPending = false
        this.hysteresis.recordMigration(dependencies.now())
        logRelayConnected(this.logRelay)
      },
      scheduleLease: (expiry) =>
        this.leaseRotation.scheduleFromLease(
          liveRelayLeaseExpiry(this.logical, this.stopped, expiry)
        ),
      scheduleDirectProbe: () => this.directProbe.schedule(),
      onBookkeepingError: (error) =>
        this.logRelay('relay bookkeeping failed after migration', error.message.slice(0, 80)),
      onDialFailure: (error) => logRelayDialFailure(this.logRelay, error)
    })
    this.directProbe = new DirectReturnProbe(dependencies, {
      hysteresis: this.hysteresis,
      canSchedule: () => this.isActive() && this.logical.getActivePath() === 'relay',
      canAttempt: () => this.isActive() && !this.operationInFlight,
      beginOperation: () => (this.operationInFlight = true),
      migrate: (client, path, abort) => this.logical.migrateTo(client, path, undefined, abort),
      onDirectMigrated: async () => {
        this.leaseRotation.clear()
        this.relayRotationPending = false
        await this.rotateCredentialIfNeeded(this.relayReconnect.resetForDirectConnection())
      },
      afterProbe: () => {
        this.operationInFlight = false
        if (
          this.pendingReplace ||
          this.relayRotationPending ||
          this.logical.getState() !== 'connected'
        ) {
          void this.recoverRelay(this.relayRotationPending)
        }
      }
    })
    this.backgroundGrace = new MobileRelayBackgroundGrace(
      dependencies,
      logical,
      this.relayReconnect,
      this.leaseRotation,
      this.directProbe,
      this.directGrace
    )
    this.backgroundGrace.setRetainHostConnection(getHostConnectionRetainRuntime())
    this.unsubscribeRetain = subscribeHostConnectionRetainRuntime((retain) => {
      this.backgroundGrace.setRetainHostConnection(retain)
    })
  }

  async start(): Promise<void> {
    this.bundle = await this.dependencies.readBundle(this.hostId).catch(() => null)
    if (this.stopped) {
      return
    }
    if (!this.bundle) {
      // Why: a Keychain race at open must not kill relay recovery for the whole
      // process lifetime; each recovery attempt re-reads the durable bundle.
      this.logRelay('credential bundle unavailable at start; recovery will re-read')
    }
    this.unsubscribeState = this.logical.onStateChange((state) => {
      if (state === 'connected') {
        this.directGrace.clear()
        if (this.logical.getActivePath() !== 'relay') {
          void this.rotateCredentialIfNeeded(this.relayReconnect.resetForDirectConnection())
        }
        this.directProbe.schedule()
      } else if (!this.backgroundGrace.isForeground()) {
        if (this.backgroundGrace.isRetainingHostConnection()) {
          recoveryPresentation.onActiveFailure(
            this.logical,
            this.relayReconnect,
            state,
            this.bundle
          )
          const relayFailure = this.relayReconnect.handleStateFailure(this.logical, state)
          logRelayDialFailure(this.logRelay, relayFailure, 'active-session')
        } else {
          this.backgroundGrace.handleStateFailure()
        }
      } else {
        // Why: the direct client enters reconnecting after its first failed
        // dial and may never publish disconnected while its retry loop lives.
        recoveryPresentation.onActiveFailure(this.logical, this.relayReconnect, state, this.bundle)
        const relayFailure = this.relayReconnect.handleStateFailure(this.logical, state)
        logRelayDialFailure(this.logRelay, relayFailure, 'active-session')
      }
    })
    if (this.relayReconnect.needsRecovery(this.logical.getState())) {
      // Why: the first direct dial can fail while encrypted relay credentials
      // are still loading, before the supervisor subscribes to state changes.
      await this.recoverRelay()
    } else {
      this.directProbe.schedule()
      this.directGrace.arm()
    }
  }

  setForeground(foreground: boolean): void {
    this.backgroundGrace.setForeground(foreground)
    if (foreground && this.relayRotationPending) {
      void this.recoverRelay(true)
    }
  }

  nudge = (reason: ForegroundNudgeReason): void => this.nudgeRouter.nudge(reason)

  stop(): void {
    this.stopped = true
    this.directProbe.stop()
    this.unsubscribeState?.()
    this.unsubscribeState = null
    this.unsubscribeRetain()
    this.backgroundGrace.stop()
  }

  private isActive(): boolean {
    return (
      !this.stopped &&
      (this.backgroundGrace.isForeground() || this.backgroundGrace.isRetainingHostConnection())
    )
  }

  private recovery(): SupervisorRecoveryContext {
    return {
      isActive: () => this.isActive(),
      hostId: this.hostId,
      bundle: () => this.bundle,
      setBundle: (bundle) => {
        this.bundle = bundle
      },
      operationInFlight: () => this.operationInFlight,
      setOperationInFlight: (value) => {
        this.operationInFlight = value
      },
      pendingReplace: () => this.pendingReplace,
      setPendingReplace: (value) => {
        this.pendingReplace = value
      },
      relayRotationPending: () => this.relayRotationPending,
      stopped: () => this.stopped,
      credentialRotationInFlight: () => this.credentialRotationInFlight,
      setCredentialRotationInFlight: (value) => {
        this.credentialRotationInFlight = value
      },
      logical: this.logical,
      relayReconnect: this.relayReconnect,
      dependencies: this.dependencies,
      logRelay: this.logRelay,
      sessionEstablisher: this.sessionEstablisher,
      leaseRotation: this.leaseRotation,
      recoverRelay: (forceReplacement, ownsRecovery) =>
        this.recoverRelay(forceReplacement, ownsRecovery)
    }
  }

  // forceReplacement: dial past the "direct still looks live" guard — a lease
  // rotation, a network-change replacement, or the happy-eyeballs grace race.
  // ownsRecovery: this dial is the connection's only hope, so a failure books the
  // shared cooldown and any session left stale-'connected' by a half-open socket
  // comes down; lease rotation clears it because armRetry owns its own retry.
  private async recoverRelay(forceReplacement = false, ownsRecovery = false): Promise<void> {
    return recoverMobileRelay(this.recovery(), forceReplacement, ownsRecovery)
  }

  private async rotateCredentialIfNeeded(force = false): Promise<void> {
    return rotateMobileRelayCredentialIfNeeded(this.recovery(), force)
  }
}
