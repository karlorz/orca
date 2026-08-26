import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import type { Socket } from 'node:net'
import { WebSocketServer, type WebSocket } from 'ws'
import {
  handleOwnMobileRelayHostControlSocket,
  type OwnMobileRelayInviteRecord
} from './own-mobile-relay-control-handler'
import {
  handleOwnMobileRelayHostDataSocket,
  handleOwnMobileRelayPhoneSocket,
  type OwnMobileRelayRouter,
  type PendingConnRecord
} from './own-mobile-relay-splice-handler'

export type OwnMobileRelayListenOptions = {
  operatorAccessToken: string
  origin: string
  identity?: { userId: string; profileId: string; organizationId: string }
  silenceLimitMs?: number
}

export type OwnMobileRelayServer = {
  origin: string
  close: () => Promise<void>
}

export type OwnMobileRelayIssuedToken = {
  relayHostId: string
  hostPublicKeyB64: string
  identity: { userId: string; profileId: string; organizationId: string }
}

const RELAY_TOKEN_TTL_MS = 60 * 60 * 1000
const DEFAULT_SILENCE_LIMIT_MS = 15_000

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body))
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': payload.byteLength
  })
  response.end(payload)
}

function bearerToken(header: string | undefined): string | null {
  if (!header?.startsWith('Bearer ')) {
    return null
  }
  const token = header.slice('Bearer '.length).trim()
  return token.length > 0 ? token : null
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk) => chunks.push(chunk as Buffer))
    request.on('end', () => {
      if (chunks.length === 0) {
        resolve(null)
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown)
      } catch {
        reject(new Error('invalid_json'))
      }
    })
    request.on('error', reject)
  })
}

export function listenOwnMobileRelay(
  options: OwnMobileRelayListenOptions
): Promise<OwnMobileRelayServer> {
  const issued = new Map<string, OwnMobileRelayIssuedToken>()
  const activeSockets = new Set<WebSocket>()
  let advertisedOrigin = options.origin
  const silenceLimitMs = options.silenceLimitMs ?? DEFAULT_SILENCE_LIMIT_MS

  const router: OwnMobileRelayRouter = {
    invites: new Map<string, OwnMobileRelayInviteRecord>(),
    pendingConns: new Map<string, PendingConnRecord>(),
    connsByTicket: new Map<string, PendingConnRecord>(),
    activeHosts: new Map<string, (msg: object) => void>()
  }

  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 })

  const server = createServer((request, response) => {
    void handleRequest(request, response)
  })

  server.on('upgrade', (request: IncomingMessage, socket: Socket, head: Buffer) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname === '/v1/host/control') {
      const relayToken = bearerToken(request.headers.authorization)
      const grant = relayToken ? issued.get(relayToken) : undefined
      if (!grant) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        return
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        activeSockets.add(ws)
        ws.once('close', () => activeSockets.delete(ws))
        handleOwnMobileRelayHostControlSocket(ws, grant, {
          advertisedOrigin,
          silenceLimitMs,
          invites: router.invites,
          onActive: (relayHostId, send) => {
            router.activeHosts.set(relayHostId, send)
          },
          onClose: (relayHostId) => {
            router.activeHosts.delete(relayHostId)
          }
        })
      })
      return
    }

    if (url.pathname.startsWith('/v1/connect/')) {
      const relayHostId = url.pathname.slice('/v1/connect/'.length)
      wss.handleUpgrade(request, socket, head, (ws) => {
        activeSockets.add(ws)
        ws.once('close', () => activeSockets.delete(ws))
        handleOwnMobileRelayPhoneSocket(ws, relayHostId, router)
      })
      return
    }

    if (url.pathname.startsWith('/v1/host/data/')) {
      const connId = url.pathname.slice('/v1/host/data/'.length)
      wss.handleUpgrade(request, socket, head, (ws) => {
        activeSockets.add(ws)
        ws.once('close', () => activeSockets.delete(ws))
        handleOwnMobileRelayHostDataSocket(ws, connId, router)
      })
      return
    }

    socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
    socket.destroy()
  })

  async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (request.method === 'GET' && url.pathname === '/health') {
      sendJson(response, 200, { ok: true })
      return
    }
    if (request.method === 'POST' && url.pathname === '/v1/desktop/auth/relay-token') {
      const access = bearerToken(request.headers.authorization)
      if (access !== options.operatorAccessToken) {
        sendJson(response, 401, { error: 'unauthorized' })
        return
      }
      let body: unknown
      try {
        body = await readJsonBody(request)
      } catch {
        sendJson(response, 400, { error: 'invalid_json' })
        return
      }
      const record = body as { relayHostId?: unknown; hostPublicKeyB64?: unknown }
      if (typeof record.relayHostId !== 'string' || typeof record.hostPublicKeyB64 !== 'string') {
        sendJson(response, 400, { error: 'invalid_request' })
        return
      }
      const relayToken = randomBytes(32).toString('base64url')
      issued.set(relayToken, {
        relayHostId: record.relayHostId,
        hostPublicKeyB64: record.hostPublicKeyB64,
        identity: options.identity ?? {
          userId: 'lab-user',
          profileId: 'lab-profile',
          organizationId: ''
        }
      })
      sendJson(response, 200, {
        relayToken,
        expiresAt: Date.now() + RELAY_TOKEN_TTL_MS
      })
      return
    }
    if (request.method === 'POST' && url.pathname === '/v1/assign') {
      const relayToken = bearerToken(request.headers.authorization)
      const grant = relayToken ? issued.get(relayToken) : undefined
      if (!grant) {
        sendJson(response, 401, { error: 'unauthorized' })
        return
      }
      let body: unknown
      try {
        body = await readJsonBody(request)
      } catch {
        sendJson(response, 400, { error: 'invalid_json' })
        return
      }
      const record = body as { v?: unknown; relayHostId?: unknown }
      if (record.v !== 1 || record.relayHostId !== grant.relayHostId) {
        sendJson(response, 400, { error: 'invalid_request' })
        return
      }
      sendJson(response, 200, {
        v: 1,
        cellUrl: advertisedOrigin,
        assignmentEpoch: 1,
        lease: randomBytes(32).toString('base64url')
      })
      return
    }
    sendJson(response, 404, { error: 'not_found' })
  }

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('own_mobile_relay_bind_failed'))
        return
      }
      const advertised = new URL(options.origin)
      advertised.port = String(address.port)
      advertisedOrigin = advertised.origin
      resolve({
        origin: advertisedOrigin,
        close: () =>
          new Promise((closeResolve, closeReject) => {
            for (const socket of activeSockets) {
              socket.terminate()
            }
            wss.close(() => {
              server.close((error) => (error ? closeReject(error) : closeResolve()))
            })
          })
      })
    })
  })
}
