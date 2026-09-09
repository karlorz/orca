import type { RelayHostCloseReason } from '../../../shared/relay-host-close-reason'
import type { RelayBrokerStatus } from './relay-session-broker'

export type RelayAuthIdentity = {
  userId: string
  profileId: string
  organizationId: string
}

export type RelayAuthContext = {
  identity: RelayAuthIdentity
  accessToken: string
  relayEntitled: boolean
}

export type CoordinatedRelayBroker = {
  closeNow(hostCloseReason?: RelayHostCloseReason): void
  isLive?(): boolean
  readonly endpoint?: { cellUrl: string } | null
}

export type RelayAuthCoordinatorOptions = {
  readContext: (options?: { forceRefresh?: boolean }) => Promise<RelayAuthContext | null>
  hasDemand?: (context: RelayAuthContext) => boolean
  openBroker: (input: {
    context: RelayAuthContext
    isCurrent: () => boolean
    refreshAccessToken: () => Promise<string | null>
  }) => Promise<CoordinatedRelayBroker>
  onStatus: (status: RelayBrokerStatus, cellUrl?: string) => void
  lingerMs?: number
  random?: () => number
}
