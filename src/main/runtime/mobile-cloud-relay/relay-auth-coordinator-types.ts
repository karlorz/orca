// Why a separate module: relay-auth-coordinator.ts sits at the max-lines cap once the fork's
// 4401 force-refresh remint is carried; its option and ownership shapes live here.
import type { RelayHostCloseReason } from '../../../shared/relay-host-close-reason'
import type { RelayBrokerStatus } from './relay-session-broker'
import type { RelayAccessTokenRefresh } from './relay-session-broker-contract'
import type { RelayUnavailable } from './relay-readiness'
import type { RelayAuthContext } from './relay-auth-identity'

export type CoordinatedRelayBroker = {
  closeNow(hostCloseReason?: RelayHostCloseReason): void
  isLive?(): boolean
  readonly endpoint?: { cellUrl: string } | null
}

export type RelayAuthCoordinatorOptions = {
  // Fork: forceRefresh rotates the cloud session before a remint (d9cd1e2fc6).
  readContext: (options?: { forceRefresh?: boolean }) => Promise<RelayAuthContext | null>
  hasDemand?: (context: RelayAuthContext) => boolean
  openBroker: (input: {
    context: RelayAuthContext
    isCurrent: () => boolean
    refreshAccessToken: () => Promise<RelayAccessTokenRefresh>
  }) => Promise<CoordinatedRelayBroker>
  onStatus: (status: RelayBrokerStatus, cellUrl?: string) => void
  lingerMs?: number
  random?: () => number
}

export type RelayReadiness =
  | { ready: true; broker: CoordinatedRelayBroker }
  | ({ ready: false } & RelayUnavailable)

export type BrokerOwnership = {
  identityKey: string
  broker: CoordinatedRelayBroker | null
  valid: boolean
}
