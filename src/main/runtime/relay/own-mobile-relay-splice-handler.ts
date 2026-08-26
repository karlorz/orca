import { createHash, randomBytes } from 'node:crypto'
import type { RawData, WebSocket } from 'ws'
import type {
  OwnMobileRelayDeviceCredentialRecord,
  OwnMobileRelayInviteRecord
} from './own-mobile-relay-types'

export type PendingConnRecord = {
  connId: string
  connTicket: string
  relayHostId: string
  relayDeviceId: string
  expiresAt: number
  kind: 'invite' | 'resume'
  acceptedAs?: 'current' | 'grace'
  phoneSocket: WebSocket
  hostSocket?: WebSocket
}

export type OwnMobileRelayRouter = {
  invites: Map<string, OwnMobileRelayInviteRecord>
  deviceCredentials: Map<string, OwnMobileRelayDeviceCredentialRecord>
  pendingConns: Map<string, PendingConnRecord>
  connsByTicket: Map<string, PendingConnRecord>
  activeHosts: Map<string, (msg: object) => void>
}

const ATTACH_DEADLINE_MS = 5_000
const LEASE_TTL_MS = 60_000

export function handleOwnMobileRelayPhoneSocket(
  ws: WebSocket,
  relayHostId: string,
  router: OwnMobileRelayRouter
): void {
  const hostSender = router.activeHosts.get(relayHostId)
  if (!hostSender) {
    ws.close(4404, 'host_not_found')
    return
  }

  let pendingConn: PendingConnRecord | null = null

  const cleanup = (): void => {
    if (pendingConn) {
      router.pendingConns.delete(pendingConn.connId)
      router.connsByTicket.delete(pendingConn.connTicket)
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

    let parsed: unknown
    try {
      parsed = JSON.parse(raw.toString('utf8'))
    } catch {
      ws.close(4401, 'invalid_json')
      return
    }

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      (parsed as { type?: unknown }).type !== 'relay-auth'
    ) {
      ws.close(4401, 'invalid_auth')
      return
    }

    const authMsg = parsed as {
      type: 'relay-auth'
      v?: unknown
      mode?: unknown
      credential?: unknown
    }

    if (authMsg.v !== 1 || authMsg.mode !== 'connect' || typeof authMsg.credential !== 'string') {
      ws.close(4401, 'invalid_auth')
      return
    }

    const invite = router.invites.get(authMsg.credential)
    if (invite) {
      if (
        invite.relayHostId !== relayHostId ||
        invite.remainingAttempts <= 0 ||
        invite.expiresAt <= Date.now()
      ) {
        invite.remainingAttempts -= 1
        if (invite.remainingAttempts <= 0) {
          router.invites.delete(authMsg.credential)
        }
        ws.send(JSON.stringify({ type: 'relay-hello', ok: false, code: 4401 }))
        ws.close(4401, 'invalid_invite')
        return
      }

      const connId = randomBytes(16).toString('hex')
      const connTicket = randomBytes(32).toString('base64url')
      const expiresAt = Date.now() + ATTACH_DEADLINE_MS

      pendingConn = {
        connId,
        connTicket,
        relayHostId,
        relayDeviceId: invite.relayDeviceId,
        expiresAt,
        kind: 'invite',
        phoneSocket: ws
      }
      router.pendingConns.set(connId, pendingConn)
      router.connsByTicket.set(connTicket, pendingConn)

      // Notify desktop host control
      hostSender({
        type: 'conn-open',
        connId,
        connTicket,
        kind: 'invite',
        relayDeviceId: invite.relayDeviceId,
        attachDeadlineMs: ATTACH_DEADLINE_MS
      })

      // Reply to phone
      ws.send(
        JSON.stringify({
          type: 'relay-hello',
          ok: true,
          credentialKind: 'invite',
          leaseExpiresAt: Date.now() + LEASE_TTL_MS
        })
      )
      return
    }

    // Check resume token
    const tokenHash = createHash('sha256').update(authMsg.credential).digest('base64url')
    let matchedDevice: OwnMobileRelayDeviceCredentialRecord | null = null
    let acceptedAs: 'current' | 'grace' | null = null

    const now = Date.now()
    for (const record of router.deviceCredentials.values()) {
      if (record.relayHostId === relayHostId) {
        if (record.currentResumeTokenHash === tokenHash && record.resumeExpiresAt > now) {
          matchedDevice = record
          acceptedAs = 'current'
          break
        }
        if (
          record.graceResumeTokenHash === tokenHash &&
          record.graceExpiresAt !== undefined &&
          record.graceExpiresAt > now
        ) {
          matchedDevice = record
          acceptedAs = 'grace'
          break
        }
      }
    }

    if (!matchedDevice || !acceptedAs) {
      ws.send(JSON.stringify({ type: 'relay-hello', ok: false, code: 4401 }))
      ws.close(4401, 'invalid_resume_token')
      return
    }

    const connId = randomBytes(16).toString('hex')
    const connTicket = randomBytes(32).toString('base64url')
    const expiresAt = Date.now() + ATTACH_DEADLINE_MS

    pendingConn = {
      connId,
      connTicket,
      relayHostId,
      relayDeviceId: matchedDevice.relayDeviceId,
      expiresAt,
      kind: 'resume',
      acceptedAs,
      phoneSocket: ws
    }
    router.pendingConns.set(connId, pendingConn)
    router.connsByTicket.set(connTicket, pendingConn)

    // Notify desktop host control
    hostSender({
      type: 'conn-open',
      connId,
      connTicket,
      kind: 'resume',
      relayDeviceId: matchedDevice.relayDeviceId,
      attachDeadlineMs: ATTACH_DEADLINE_MS
    })

    // Reply to phone
    ws.send(
      JSON.stringify({
        type: 'relay-hello',
        ok: true,
        credentialKind: 'resume',
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
    router.pendingConns.delete(connId)
    router.connsByTicket.delete(pendingConn.connTicket)
    ws.close(4401, 'attach_expired')
    return
  }

  const cleanup = (): void => {
    router.pendingConns.delete(connId)
    router.connsByTicket.delete(pendingConn.connTicket)
    if (pendingConn.phoneSocket && pendingConn.phoneSocket.readyState === ws.OPEN) {
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

    let parsed: unknown
    try {
      parsed = JSON.parse(raw.toString('utf8'))
    } catch {
      ws.close(4401, 'invalid_json')
      return
    }

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      (parsed as { type?: unknown }).type !== 'host-data-auth'
    ) {
      ws.close(4401, 'invalid_auth')
      return
    }

    const authMsg = parsed as {
      type: 'host-data-auth'
      v?: unknown
      connTicket?: unknown
      generation?: unknown
    }

    if (
      authMsg.v !== 1 ||
      authMsg.connTicket !== pendingConn.connTicket ||
      authMsg.generation !== 1
    ) {
      ws.close(4401, 'auth_mismatch')
      return
    }

    if (Date.now() > pendingConn.expiresAt) {
      router.pendingConns.delete(connId)
      router.connsByTicket.delete(pendingConn.connTicket)
      ws.close(4401, 'attach_expired')
      return
    }

    pendingConn.hostSocket = ws
    spliceSockets(pendingConn.phoneSocket, ws)
  })
}

function spliceSockets(phone: WebSocket, host: WebSocket): void {
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
