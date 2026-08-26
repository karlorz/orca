import { randomBytes } from 'node:crypto'
import type { WebSocket } from 'ws'
import {
  GRACE_TOKEN_TTL_MS,
  INVITE_MAX_ATTEMPTS,
  INVITE_TOKEN_TTL_MS,
  RESUME_TOKEN_TTL_MS,
  type OwnMobileRelayDeviceCredentialRecord,
  type OwnMobileRelayInviteRecord
} from './own-mobile-relay-types'
import type { OwnMobileRelayIssuedToken } from './own-mobile-relay-http'

export type OwnMobileRelayControlContext = {
  advertisedOrigin: string
  silenceLimitMs: number
  invites?: Map<string, OwnMobileRelayInviteRecord>
  deviceCredentials?: Map<string, OwnMobileRelayDeviceCredentialRecord>
  pendingConns?: Map<string, { relayDeviceId: string; acceptedAs?: 'current' | 'grace' }>
  onActive?: (relayHostId: string, send: (msg: object) => void) => void
  onClose?: (relayHostId: string) => void
}

export function handleActiveControlMessage(
  ws: WebSocket,
  grant: OwnMobileRelayIssuedToken,
  options: OwnMobileRelayControlContext,
  msg: Record<string, unknown>,
  closeSocket: (code: number, reason?: string) => void
): void {
  if (msg.type === 'ping' && typeof msg.t === 'number') {
    ws.send(JSON.stringify({ type: 'pong', t: msg.t }))
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
    handleCredentialInstall(ws, grant, options, msg)
    return
  }

  if (
    msg.type === 'device-credential-install-status' &&
    msg.v === 1 &&
    typeof msg.reqId === 'string' &&
    typeof msg.relayDeviceId === 'string'
  ) {
    handleCredentialInstallStatus(ws, grant, options, msg)
    return
  }

  if (
    msg.type === 'device-resume-confirm' &&
    msg.v === 1 &&
    typeof msg.reqId === 'string' &&
    typeof msg.basisConnId === 'string'
  ) {
    handleResumeConfirm(ws, grant, options, msg)
    return
  }

  if (
    msg.type === 'device-revoke' &&
    typeof msg.reqId === 'string' &&
    typeof msg.relayDeviceId === 'string'
  ) {
    const deviceKey = `${grant.relayHostId}:${msg.relayDeviceId}`
    options.deviceCredentials?.delete(deviceKey)
    ws.send(JSON.stringify({ type: 'device-revoked', reqId: msg.reqId }))
    return
  }

  closeSocket(4401, 'unknown_control_message')
}

function handleCredentialInstall(
  ws: WebSocket,
  grant: OwnMobileRelayIssuedToken,
  options: OwnMobileRelayControlContext,
  msg: Record<string, unknown>
): void {
  const reqId = msg.reqId as string
  const relayDeviceId = msg.relayDeviceId as string
  const newResumeTokenHash = msg.newResumeTokenHash as string
  const auth = msg.authorization as { mode?: string }

  if (!/^[A-Za-z0-9_-]{43}$/.test(newResumeTokenHash)) {
    ws.send(JSON.stringify({ type: 'control-error', reqId, code: 'invalid_token_hash' }))
    return
  }

  if (auth.mode !== 'relay-basis' && auth.mode !== 'authenticated-direct') {
    ws.send(JSON.stringify({ type: 'control-error', reqId, code: 'invalid_authorization' }))
    return
  }

  const credentialsMap = options.deviceCredentials
  const deviceKey = `${grant.relayHostId}:${relayDeviceId}`
  const existing = credentialsMap?.get(deviceKey)

  if (
    typeof msg.expectedCurrentHash === 'string' &&
    existing?.currentResumeTokenHash !== msg.expectedCurrentHash
  ) {
    ws.send(JSON.stringify({ type: 'control-error', reqId, code: 'hash-mismatch' }))
    return
  }

  const now = Date.now()
  const currentVersion = existing ? existing.currentVersion + 1 : 1
  const resumeExpiresAt = now + RESUME_TOKEN_TTL_MS

  const record: OwnMobileRelayDeviceCredentialRecord = {
    relayHostId: grant.relayHostId,
    relayDeviceId,
    lastInstallReqId: reqId,
    currentResumeTokenHash: newResumeTokenHash,
    currentVersion,
    resumeExpiresAt,
    authorizationMode: auth.mode
  }

  if (existing) {
    record.graceResumeTokenHash = existing.currentResumeTokenHash
    record.graceExpiresAt = now + GRACE_TOKEN_TTL_MS
  }

  credentialsMap?.set(deviceKey, record)

  ws.send(
    JSON.stringify({
      type: 'device-credential-installed',
      v: 1,
      reqId,
      authorizationMode: record.authorizationMode,
      currentVersion: record.currentVersion,
      resumeExpiresAt: record.resumeExpiresAt,
      ...(record.graceExpiresAt !== undefined ? { graceExpiresAt: record.graceExpiresAt } : {})
    })
  )
}

function handleCredentialInstallStatus(
  ws: WebSocket,
  grant: OwnMobileRelayIssuedToken,
  options: OwnMobileRelayControlContext,
  msg: Record<string, unknown>
): void {
  const reqId = msg.reqId as string
  const relayDeviceId = msg.relayDeviceId as string
  const deviceKey = `${grant.relayHostId}:${relayDeviceId}`
  const record = options.deviceCredentials?.get(deviceKey)

  if (!record) {
    ws.send(
      JSON.stringify({
        type: 'device-credential-install-status-result',
        v: 1,
        reqId,
        state: 'not-found'
      })
    )
    return
  }

  ws.send(
    JSON.stringify({
      type: 'device-credential-install-status-result',
      v: 1,
      reqId,
      state: 'committed',
      result: {
        v: 1,
        reqId: record.lastInstallReqId,
        authorizationMode: record.authorizationMode,
        currentVersion: record.currentVersion,
        resumeExpiresAt: record.resumeExpiresAt,
        ...(record.graceExpiresAt !== undefined ? { graceExpiresAt: record.graceExpiresAt } : {})
      }
    })
  )
}

function handleResumeConfirm(
  ws: WebSocket,
  grant: OwnMobileRelayIssuedToken,
  options: OwnMobileRelayControlContext,
  msg: Record<string, unknown>
): void {
  const reqId = msg.reqId as string
  const basisConnId = msg.basisConnId as string
  const pendingConn = options.pendingConns?.get(basisConnId)

  if (!pendingConn) {
    ws.send(JSON.stringify({ type: 'control-error', reqId, code: 'conn-not-found' }))
    return
  }

  const deviceKey = `${grant.relayHostId}:${pendingConn.relayDeviceId}`
  const record = options.deviceCredentials?.get(deviceKey)
  if (!record) {
    ws.send(JSON.stringify({ type: 'control-error', reqId, code: 'device-not-found' }))
    return
  }

  ws.send(
    JSON.stringify({
      type: 'device-resume-confirmed',
      v: 1,
      reqId,
      currentVersion: record.currentVersion,
      acceptedAs: pendingConn.acceptedAs ?? 'current',
      renewed: false,
      resumeExpiresAt: record.resumeExpiresAt,
      ...(record.graceExpiresAt !== undefined ? { graceExpiresAt: record.graceExpiresAt } : {})
    })
  )
}
