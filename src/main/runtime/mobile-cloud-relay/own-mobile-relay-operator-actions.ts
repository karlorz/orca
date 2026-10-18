import type { OwnMobileRelayAuditEvent, OwnMobileRelayAuditLog } from './own-mobile-relay-audit'
import type {
  OwnMobileRelaySecurityState,
  SecurityStateRedactedAccessSession,
  SecurityStateRedactedDeviceCredential,
  SecurityStateRedactedRelayGrant
} from './own-mobile-relay-security-state'
import { emitAudit } from './own-mobile-relay-audit-emit'

export type OperatorConsoleSource = {
  securityState: OwnMobileRelaySecurityState
  auditLog?: OwnMobileRelayAuditLog
  hostControlLive?: () => boolean
}

export type OperatorConsoleState = {
  generatedAt: number
  hostControlLive: boolean
  sessions: SecurityStateRedactedAccessSession[]
  grants: SecurityStateRedactedRelayGrant[]
  devices: SecurityStateRedactedDeviceCredential[]
  events: OwnMobileRelayAuditEvent[]
}

export async function loadOperatorConsoleState(
  source: OperatorConsoleSource,
  now: number = Date.now()
): Promise<OperatorConsoleState> {
  const [sessions, grants, devices, events] = await Promise.all([
    source.securityState.listAccessSessions(now),
    source.securityState.listRelayGrants(now),
    source.securityState.listDeviceCredentials(),
    source.auditLog ? source.auditLog.list({ order: 'desc' }) : Promise.resolve([])
  ])
  return {
    generatedAt: now,
    hostControlLive: source.hostControlLive ? source.hostControlLive() : false,
    sessions,
    grants,
    devices,
    events
  }
}

export async function revokeOperatorDevice(
  source: OperatorConsoleSource,
  relayHostId: string,
  deviceId: string
): Promise<void> {
  await source.securityState.revokeDeviceCredential(relayHostId, deviceId)
  await emitAudit(source.auditLog, 'device.revoked', {
    relayHostId,
    deviceId,
    actor: 'operator'
  })
}

export async function revokeOperatorGrant(
  source: OperatorConsoleSource,
  grantId: string
): Promise<boolean> {
  const success = await source.securityState.revokeRelayGrantById(grantId)
  if (success) {
    await emitAudit(source.auditLog, 'grant.revoked', {
      grantId,
      actor: 'operator'
    })
  }
  return success
}
