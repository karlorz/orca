import { randomBytes } from 'node:crypto'
import type { WebSocket } from 'ws'
import {
  INVITE_MAX_ATTEMPTS,
  INVITE_TOKEN_TTL_MS,
  type OwnMobileRelayInviteRecord
} from './own-mobile-relay-types'
import type {
  OwnMobileRelaySecurityState,
  SecurityStateRelayGrant
} from './own-mobile-relay-security-state'
import type { OwnMobileRelayAuditLog } from './own-mobile-relay-audit'
import { emitAudit } from './own-mobile-relay-audit-emit'

export type OwnMobileRelayPendingConnContext = {
  relayDeviceId: string
  acceptedAs?: 'current' | 'grace'
  currentVersion?: number
  resumeExpiresAt?: number
  graceExpiresAt?: number
}

export type OwnMobileRelayControlContext = {
  advertisedOrigin: string
  silenceLimitMs: number
  securityState: OwnMobileRelaySecurityState
  invites?: Map<string, OwnMobileRelayInviteRecord>
  pendingConns?: Map<string, OwnMobileRelayPendingConnContext>
  auditLog?: OwnMobileRelayAuditLog
  onActive?: (relayHostId: string, send: (msg: object) => void) => void
  onClose?: (
    relayHostId: string,
    sender?: (msg: object) => void,
    closeCode?: number,
    reason?: string
  ) => void
  onGrantRotated?: (newGrant: SecurityStateRelayGrant) => void
}

export async function handleActiveControlMessage(
  ws: WebSocket,
  grant: SecurityStateRelayGrant,
  options: OwnMobileRelayControlContext,
  msg: Record<string, unknown>,
  closeSocket: (code: number, reason?: string) => void
): Promise<void> {
  if (msg.type === 'auth-refresh' && typeof msg.relayJwt === 'string') {
    const replacementGrant = await options.securityState.validateRelayGrantByToken(msg.relayJwt)
    if (
      !replacementGrant ||
      replacementGrant.relayHostId !== grant.relayHostId ||
      replacementGrant.hostPublicKeyB64 !== grant.hostPublicKeyB64 ||
      replacementGrant.identity.userId !== grant.identity.userId ||
      replacementGrant.identity.profileId !== grant.identity.profileId ||
      replacementGrant.identity.organizationId !== grant.identity.organizationId
    ) {
      closeSocket(4401, 'invalid_auth_refresh')
      return
    }
    const previousGrantId = grant.grantId
    options.onGrantRotated?.(replacementGrant)
    await options.securityState.revokeRelayGrantById(previousGrantId)
    return
  }

  if (msg.type === 'ping' && typeof msg.t === 'number') {
    ws.send(JSON.stringify({ type: 'pong', t: msg.t }))
    return
  }

  if (msg.type === 'pong' && typeof msg.t === 'number') {
    return
  }

  if (
    msg.type === 'invite-create' &&
    typeof msg.reqId === 'string' &&
    typeof msg.relayDeviceId === 'string'
  ) {
    const inviteToken = randomBytes(32).toString('base64url')
    const expiresAt = Date.now() + INVITE_TOKEN_TTL_MS
    const maxAttempts = INVITE_MAX_ATTEMPTS
    options.invites?.set(inviteToken, {
      inviteToken,
      relayHostId: grant.relayHostId,
      relayDeviceId: msg.relayDeviceId,
      expiresAt,
      remainingAttempts: maxAttempts
    })
    ws.send(
      JSON.stringify({
        type: 'invite-created',
        reqId: msg.reqId,
        inviteToken,
        expiresAt,
        maxAttempts
      })
    )
    return
  }

  if (
    msg.type === 'device-credential-install' &&
    msg.v === 1 &&
    typeof msg.reqId === 'string' &&
    typeof msg.relayDeviceId === 'string' &&
    typeof msg.newResumeTokenHash === 'string' &&
    typeof msg.authorization === 'object' &&
    msg.authorization !== null
  ) {
    await handleCredentialInstall(ws, grant, options, msg)
    return
  }

  if (
    msg.type === 'device-credential-install-status' &&
    msg.v === 1 &&
    typeof msg.reqId === 'string' &&
    typeof msg.relayDeviceId === 'string'
  ) {
    await handleCredentialInstallStatus(ws, grant, options, msg)
    return
  }

  if (
    msg.type === 'device-resume-confirm' &&
    msg.v === 1 &&
    typeof msg.reqId === 'string' &&
    typeof msg.basisConnId === 'string'
  ) {
    handleResumeConfirm(ws, options, msg)
    return
  }

  if (
    msg.type === 'device-revoke' &&
    typeof msg.reqId === 'string' &&
    typeof msg.relayDeviceId === 'string'
  ) {
    await options.securityState.revokeDeviceCredential(grant.relayHostId, msg.relayDeviceId)
    await emitAudit(options.auditLog, 'device.revoked', {
      relayHostId: grant.relayHostId,
      deviceId: msg.relayDeviceId,
      actor: 'host'
    })
    ws.send(JSON.stringify({ type: 'device-revoked', reqId: msg.reqId }))
    return
  }

  closeSocket(4401, 'unknown_control_message')
}

async function handleCredentialInstall(
  ws: WebSocket,
  grant: SecurityStateRelayGrant,
  options: OwnMobileRelayControlContext,
  msg: Record<string, unknown>
): Promise<void> {
  const reqId = msg.reqId as string
  const relayDeviceId = msg.relayDeviceId as string
  const newResumeTokenHash = msg.newResumeTokenHash as string
  const expectedCurrentHash =
    typeof msg.expectedCurrentHash === 'string' ? msg.expectedCurrentHash : undefined
  const auth = msg.authorization as { mode?: unknown }

  const result = await options.securityState.installDeviceCredential({
    relayHostId: grant.relayHostId,
    relayDeviceId,
    reqId,
    newResumeTokenHash,
    expectedCurrentHash,
    authorizationMode: auth.mode as 'relay-basis' | 'authenticated-direct'
  })

  if (!result.ok) {
    ws.send(JSON.stringify({ type: 'control-error', reqId, code: result.code }))
    return
  }

  await emitAudit(options.auditLog, 'device.installed', {
    relayHostId: grant.relayHostId,
    deviceId: relayDeviceId,
    actor: 'host'
  })

  ws.send(
    JSON.stringify({
      type: 'device-credential-installed',
      v: 1,
      reqId: result.installed.reqId,
      authorizationMode: result.installed.authorizationMode,
      currentVersion: result.installed.currentVersion,
      resumeExpiresAt: result.installed.resumeExpiresAt,
      ...(result.installed.graceExpiresAt !== undefined
        ? { graceExpiresAt: result.installed.graceExpiresAt }
        : {})
    })
  )
}

async function handleCredentialInstallStatus(
  ws: WebSocket,
  grant: SecurityStateRelayGrant,
  options: OwnMobileRelayControlContext,
  msg: Record<string, unknown>
): Promise<void> {
  const reqId = msg.reqId as string
  const relayDeviceId = msg.relayDeviceId as string
  const status = await options.securityState.getDeviceCredentialInstallStatus(
    grant.relayHostId,
    relayDeviceId,
    reqId
  )

  ws.send(
    JSON.stringify({
      ...status,
      type: 'device-credential-install-status-result'
    })
  )
}

function handleResumeConfirm(
  ws: WebSocket,
  options: OwnMobileRelayControlContext,
  msg: Record<string, unknown>
): void {
  const reqId = msg.reqId as string
  const basisConnId = msg.basisConnId as string
  const pendingConn = options.pendingConns?.get(basisConnId)

  if (
    !pendingConn ||
    pendingConn.currentVersion === undefined ||
    pendingConn.resumeExpiresAt === undefined
  ) {
    ws.send(JSON.stringify({ type: 'control-error', reqId, code: 'conn-not-found' }))
    return
  }

  ws.send(
    JSON.stringify({
      type: 'device-resume-confirmed',
      v: 1,
      reqId,
      currentVersion: pendingConn.currentVersion,
      acceptedAs: pendingConn.acceptedAs ?? 'current',
      renewed: false,
      resumeExpiresAt: pendingConn.resumeExpiresAt,
      ...(pendingConn.graceExpiresAt !== undefined
        ? { graceExpiresAt: pendingConn.graceExpiresAt }
        : {})
    })
  )
}
