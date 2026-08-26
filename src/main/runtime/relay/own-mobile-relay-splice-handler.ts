import { createHash, randomBytes } from 'node:crypto'
import type { RawData, WebSocket } from 'ws'
import type {
  OwnMobileRelayBufferedFrame,
  OwnMobileRelayDeviceCredentialRecord,
  OwnMobileRelayRouter,
  PendingConnRecord
} from './own-mobile-relay-types'

export type { OwnMobileRelayBufferedFrame, OwnMobileRelayRouter, PendingConnRecord }

const MAX_BUFFERED_FRAMES = 16
const MAX_BUFFERED_BYTES = 1024 * 1024
const ATTACH_DEADLINE_MS = 5_000
const LEASE_TTL_MS = 60_000

function frameByteLength(raw: RawData): number {
  if (typeof raw === 'string') {
    return Buffer.byteLength(raw)
  }
  if (Buffer.isBuffer(raw)) {
    return raw.length
  }
  return Array.isArray(raw) ? raw.reduce((sum, b) => sum + b.length, 0) : raw.byteLength
}

function clearPendingConn(pendingConn: PendingConnRecord, router: OwnMobileRelayRouter): void {
  if (pendingConn.attachTimer) {
    clearTimeout(pendingConn.attachTimer)
    pendingConn.attachTimer = undefined
  }
  if (pendingConn.onPhoneMessage) {
    pendingConn.phoneSocket.off('message', pendingConn.onPhoneMessage)
    pendingConn.onPhoneMessage = undefined
  }
  router.pendingConns.delete(pendingConn.connId)
  router.connsByTicket.delete(pendingConn.connTicket)
}

function setupPendingBuffering(
  pendingConn: PendingConnRecord,
  router: OwnMobileRelayRouter,
  ws: WebSocket
): void {
  router.pendingConns.set(pendingConn.connId, pendingConn)
  router.connsByTicket.set(pendingConn.connTicket, pendingConn)

  const onPhoneMessage = (raw: RawData, isBinary: boolean): void => {
    if (!pendingConn.bufferedFrames) {
      return
    }
    const newBytes = (pendingConn.bufferedBytes ?? 0) + frameByteLength(raw)
    if (
      pendingConn.bufferedFrames.length + 1 > MAX_BUFFERED_FRAMES ||
      newBytes > MAX_BUFFERED_BYTES
    ) {
      clearPendingConn(pendingConn, router)
      ws.close(4401, 'buffer_limit_exceeded')
      return
    }
    pendingConn.bufferedFrames.push({ raw, isBinary })
    pendingConn.bufferedBytes = newBytes
  }

  pendingConn.onPhoneMessage = onPhoneMessage
  ws.on('message', onPhoneMessage)

  const remaining = Math.max(0, pendingConn.expiresAt - Date.now())
  pendingConn.attachTimer = setTimeout(() => {
    clearPendingConn(pendingConn, router)
    if (ws.readyState === ws.OPEN) {
      ws.close(4408, 'attach_timeout')
    }
  }, remaining)
}

function matchDeviceCredential(
  deviceCredentials: Map<string, OwnMobileRelayDeviceCredentialRecord>,
  relayHostId: string,
  tokenHash: string
): { device: OwnMobileRelayDeviceCredentialRecord; acceptedAs: 'current' | 'grace' } | null {
  const now = Date.now()
  for (const record of deviceCredentials.values()) {
    if (record.relayHostId === relayHostId) {
      if (record.currentResumeTokenHash === tokenHash && record.resumeExpiresAt > now) {
        return { device: record, acceptedAs: 'current' }
      }
      if (
        record.graceResumeTokenHash === tokenHash &&
        record.graceExpiresAt !== undefined &&
        record.graceExpiresAt > now
      ) {
        return { device: record, acceptedAs: 'grace' }
      }
    }
  }
  return null
}

export function handleOwnMobileRelayPhoneSocket(
  ws: WebSocket,
  relayHostId: string,
  router: OwnMobileRelayRouter
): void {
  const hostSender = router.activeHosts.get(relayHostId)
  if (!hostSender) {
    process.stderr.write(
      `[own-mobile-relay] phone-4404 host_not_found relayHostId=${relayHostId}\n`
    )
    ws.close(4404, 'host_not_found')
    return
  }

  let pendingConn: PendingConnRecord | null = null

  const cleanup = (): void => {
    if (pendingConn) {
      clearPendingConn(pendingConn, router)
      if (pendingConn.hostSocket && pendingConn.hostSocket.readyState === ws.OPEN) {
        pendingConn.hostSocket.close(4408, 'peer_closed')
      }
    }
  }

  ws.once('error', () => {
    cleanup()
    ws.close(4401, 'socket_error')
  })
  ws.once('close', cleanup)

  ws.once('message', (raw: RawData, isBinary: boolean) => {
    if (isBinary) {
      ws.close(4401, 'binary_frame_rejected')
      return
    }

    let parsed: { type?: unknown; v?: unknown; mode?: unknown; credential?: unknown }
    try {
      parsed = JSON.parse(raw.toString('utf8'))
    } catch {
      ws.close(4401, 'invalid_json')
      return
    }

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      parsed.type !== 'relay-auth' ||
      parsed.v !== 1 ||
      parsed.mode !== 'connect' ||
      typeof parsed.credential !== 'string'
    ) {
      ws.close(4401, 'invalid_auth')
      return
    }

    const invite = router.invites.get(parsed.credential)
    let relayDeviceId = ''
    let kind: 'invite' | 'resume' = 'invite'
    let acceptedAs: 'current' | 'grace' | undefined

    if (invite) {
      if (
        invite.relayHostId !== relayHostId ||
        invite.remainingAttempts <= 0 ||
        invite.expiresAt <= Date.now()
      ) {
        invite.remainingAttempts -= 1
        if (invite.remainingAttempts <= 0) {
          router.invites.delete(parsed.credential)
        }
        ws.send(JSON.stringify({ type: 'relay-hello', ok: false, code: 4401 }))
        ws.close(4401, 'invalid_invite')
        return
      }
      relayDeviceId = invite.relayDeviceId
    } else {
      const tokenHash = createHash('sha256').update(parsed.credential).digest('base64url')
      const match = matchDeviceCredential(router.deviceCredentials, relayHostId, tokenHash)
      if (!match) {
        ws.send(JSON.stringify({ type: 'relay-hello', ok: false, code: 4401 }))
        ws.close(4401, 'invalid_resume_token')
        return
      }
      relayDeviceId = match.device.relayDeviceId
      kind = 'resume'
      acceptedAs = match.acceptedAs
    }

    pendingConn = {
      connId: randomBytes(16).toString('hex'),
      connTicket: randomBytes(32).toString('base64url'),
      relayHostId,
      relayDeviceId,
      expiresAt: Date.now() + ATTACH_DEADLINE_MS,
      kind,
      acceptedAs,
      phoneSocket: ws,
      bufferedFrames: [],
      bufferedBytes: 0
    }
    setupPendingBuffering(pendingConn, router, ws)

    hostSender({
      type: 'conn-open',
      connId: pendingConn.connId,
      connTicket: pendingConn.connTicket,
      kind,
      relayDeviceId,
      attachDeadlineMs: ATTACH_DEADLINE_MS
    })

    ws.send(
      JSON.stringify({
        type: 'relay-hello',
        ok: true,
        credentialKind: kind,
        leaseExpiresAt: Date.now() + LEASE_TTL_MS
      })
    )
  })
}

export function handleOwnMobileRelayHostDataSocket(
  ws: WebSocket,
  connId: string,
  router: OwnMobileRelayRouter
): void {
  const pendingConn = router.pendingConns.get(connId)
  if (!pendingConn) {
    ws.close(4401, 'conn_not_found')
    return
  }

  if (Date.now() > pendingConn.expiresAt) {
    clearPendingConn(pendingConn, router)
    ws.close(4401, 'attach_expired')
    return
  }

  const cleanup = (): void => {
    clearPendingConn(pendingConn, router)
    if (pendingConn.phoneSocket?.readyState === ws.OPEN) {
      pendingConn.phoneSocket.close(4408, 'peer_closed')
    }
  }

  ws.once('error', () => {
    cleanup()
    ws.close(4401, 'socket_error')
  })
  ws.once('close', cleanup)

  ws.once('message', (raw: RawData, isBinary: boolean) => {
    if (isBinary) {
      ws.close(4401, 'binary_frame_rejected')
      return
    }

    let parsed: { type?: unknown; v?: unknown; connTicket?: unknown; generation?: unknown }
    try {
      parsed = JSON.parse(raw.toString('utf8'))
    } catch {
      ws.close(4401, 'invalid_json')
      return
    }

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      parsed.type !== 'host-data-auth' ||
      parsed.v !== 1 ||
      parsed.connTicket !== pendingConn.connTicket ||
      parsed.generation !== 1
    ) {
      ws.close(4401, 'invalid_auth')
      return
    }

    if (Date.now() > pendingConn.expiresAt) {
      clearPendingConn(pendingConn, router)
      ws.close(4401, 'attach_expired')
      return
    }

    clearPendingConn(pendingConn, router)
    pendingConn.hostSocket = ws
    const buffered = pendingConn.bufferedFrames ?? []
    pendingConn.bufferedFrames = undefined
    pendingConn.bufferedBytes = undefined

    spliceSockets(pendingConn.phoneSocket, ws, buffered)
  })
}

function spliceSockets(
  phone: WebSocket,
  host: WebSocket,
  bufferedFrames?: OwnMobileRelayBufferedFrame[]
): void {
  const forwardToHost = (raw: RawData, isBinary: boolean): void => {
    if (host.readyState === host.OPEN) {
      host.send(raw, { binary: isBinary })
    }
  }

  const forwardToPhone = (raw: RawData, isBinary: boolean): void => {
    if (phone.readyState === phone.OPEN) {
      phone.send(raw, { binary: isBinary })
    }
  }

  phone.on('message', forwardToHost)
  host.on('message', forwardToPhone)

  if (bufferedFrames && bufferedFrames.length > 0) {
    for (const frame of bufferedFrames) {
      if (host.readyState === host.OPEN) {
        host.send(frame.raw, { binary: frame.isBinary })
      }
    }
  }

  phone.once('close', () => {
    host.off('message', forwardToPhone)
    if (host.readyState === host.OPEN) {
      host.close(4408, 'peer_closed')
    }
  })

  host.once('close', () => {
    phone.off('message', forwardToHost)
    if (phone.readyState === phone.OPEN) {
      phone.close(4408, 'peer_closed')
    }
  })
}
