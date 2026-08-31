import type { IncomingMessage } from 'node:http'
import type { Socket } from 'node:net'
import type { WebSocketServer, WebSocket } from 'ws'
import { handleOwnMobileRelayHostControlSocket } from './own-mobile-relay-control-handler'
import {
  handleOwnMobileRelayHostDataSocket,
  handleOwnMobileRelayPhoneSocket,
  type OwnMobileRelayRouter
} from './own-mobile-relay-splice-handler'
import { bearerToken } from './own-mobile-relay-http-utils'
import type { OwnMobileRelaySecurityState } from './own-mobile-relay-security-state'
import type { OwnMobileRelayAuditLog } from './own-mobile-relay-audit'
import { emitAudit } from './own-mobile-relay-audit-emit'

export type OwnMobileRelayUpgradeContext = {
  securityState: OwnMobileRelaySecurityState
  activeSockets: Set<WebSocket>
  advertisedOriginCallback: () => string
  silenceLimitMs: number
  router: OwnMobileRelayRouter
  auditLog?: OwnMobileRelayAuditLog
}

export function registerOwnMobileRelayUpgrades(
  wss: WebSocketServer,
  context: OwnMobileRelayUpgradeContext
): (request: IncomingMessage, socket: Socket, head: Buffer) => void {
  return async (request, socket, head) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname === '/v1/host/control') {
      const relayToken = bearerToken(request.headers.authorization)
      const grant = relayToken
        ? await context.securityState.validateRelayGrantByToken(relayToken)
        : null
      if (!grant) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        return
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        context.activeSockets.add(ws)
        const cleanup = (): void => {
          context.activeSockets.delete(ws)
        }
        ws.once('close', cleanup)
        ws.once('error', cleanup)
        handleOwnMobileRelayHostControlSocket(ws, grant, {
          advertisedOrigin: context.advertisedOriginCallback(),
          silenceLimitMs: context.silenceLimitMs,
          securityState: context.securityState,
          invites: context.router.invites,
          pendingConns: context.router.pendingConns,
          auditLog: context.auditLog,
          onActive: (relayHostId, send) => {
            const wasRegistered = context.router.activeHosts.has(relayHostId)
            context.router.activeHosts.set(relayHostId, send)
            if (!wasRegistered) {
              void emitAudit(context.auditLog, 'host.control.up', {
                relayHostId,
                hostControlLive: true
              })
            }
          },
          onClose: (relayHostId, sender, closeCode, reason) => {
            // Why: only the socket that owns the registration may remove it —
            // stale or duplicate control sockets for the same host must not
            // knock out a live registration (phone would see 4404).
            if (sender && context.router.activeHosts.get(relayHostId) === sender) {
              context.router.activeHosts.delete(relayHostId)
              void emitAudit(context.auditLog, 'host.control.down', {
                relayHostId,
                ...(closeCode !== undefined ? { closeCode } : {}),
                ...(reason !== undefined && reason !== '' ? { reason } : {}),
                hostControlLive: false
              })
            }
          }
        })
      })
      return
    }

    if (url.pathname.startsWith('/v1/connect/')) {
      const relayHostId = url.pathname.slice('/v1/connect/'.length)
      wss.handleUpgrade(request, socket, head, (ws) => {
        context.activeSockets.add(ws)
        const cleanup = (): void => {
          context.activeSockets.delete(ws)
        }
        ws.once('close', cleanup)
        ws.once('error', cleanup)
        handleOwnMobileRelayPhoneSocket(
          ws,
          relayHostId,
          context.router,
          context.securityState,
          context.auditLog
        )
      })
      return
    }

    if (url.pathname.startsWith('/v1/host/data/')) {
      const connId = url.pathname.slice('/v1/host/data/'.length)
      wss.handleUpgrade(request, socket, head, (ws) => {
        context.activeSockets.add(ws)
        const cleanup = (): void => {
          context.activeSockets.delete(ws)
        }
        ws.once('close', cleanup)
        ws.once('error', cleanup)
        handleOwnMobileRelayHostDataSocket(ws, connId, context.router)
      })
      return
    }

    socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
    socket.destroy()
  }
}
