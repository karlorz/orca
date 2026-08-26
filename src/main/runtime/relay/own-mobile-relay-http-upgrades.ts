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
import type { OwnMobileRelayIssuedToken } from './own-mobile-relay-http'

export type OwnMobileRelayUpgradeContext = {
  issued: Map<string, OwnMobileRelayIssuedToken>
  activeSockets: Set<WebSocket>
  advertisedOriginCallback: () => string
  silenceLimitMs: number
  router: OwnMobileRelayRouter
}

export function registerOwnMobileRelayUpgrades(
  wss: WebSocketServer,
  context: OwnMobileRelayUpgradeContext
): (request: IncomingMessage, socket: Socket, head: Buffer) => void {
  return (request, socket, head) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname === '/v1/host/control') {
      const relayToken = bearerToken(request.headers.authorization)
      const grant = relayToken ? context.issued.get(relayToken) : undefined
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
          invites: context.router.invites,
          deviceCredentials: context.router.deviceCredentials,
          pendingConns: context.router.pendingConns,
          onActive: (relayHostId, send) => {
            context.router.activeHosts.set(relayHostId, send)
          },
          onClose: (relayHostId) => {
            context.router.activeHosts.delete(relayHostId)
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
        handleOwnMobileRelayPhoneSocket(ws, relayHostId, context.router)
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
