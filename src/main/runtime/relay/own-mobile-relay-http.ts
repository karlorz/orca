import { createServer } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import type {
  OwnMobileRelayDeviceCredentialRecord,
  OwnMobileRelayInviteRecord,
  OwnMobileRelayOperatorConfig
} from './own-mobile-relay-types'
import {
  createOwnMobileRelayAuthStore,
  type OwnMobileRelayAuthStore
} from './own-mobile-relay-auth'
import type { OwnMobileRelayRouter, PendingConnRecord } from './own-mobile-relay-splice-handler'
import { registerOwnMobileRelayUpgrades } from './own-mobile-relay-http-upgrades'
import { createOwnMobileRelayRequestHandler } from './own-mobile-relay-request-routes'

export type OwnMobileRelayListenOptions = {
  operator?: OwnMobileRelayOperatorConfig
  clientId?: string
  origin: string
  listenHost?: string
  listenPort?: number
  silenceLimitMs?: number
}

export type OwnMobileRelayServer = {
  origin: string
  boundPort: number
  close: () => Promise<void>
}

export type OwnMobileRelayIssuedToken = {
  relayHostId: string
  hostPublicKeyB64: string
  identity: { userId: string; profileId: string; organizationId: string }
}

const DEFAULT_SILENCE_LIMIT_MS = 15_000

export function listenOwnMobileRelay(
  options: OwnMobileRelayListenOptions
): Promise<OwnMobileRelayServer> {
  const issued = new Map<string, OwnMobileRelayIssuedToken>()
  const activeSockets = new Set<WebSocket>()
  const authStore: OwnMobileRelayAuthStore = createOwnMobileRelayAuthStore()
  let advertisedOrigin = options.origin
  const silenceLimitMs = options.silenceLimitMs ?? DEFAULT_SILENCE_LIMIT_MS
  const operator = options.operator
  const configuredClientId = options.clientId ?? 'orca-desktop'
  const listenHost = options.listenHost ?? '127.0.0.1'
  const listenPort = options.listenPort ?? 0

  const router: OwnMobileRelayRouter = {
    invites: new Map<string, OwnMobileRelayInviteRecord>(),
    deviceCredentials: new Map<string, OwnMobileRelayDeviceCredentialRecord>(),
    pendingConns: new Map<string, PendingConnRecord>(),
    connsByTicket: new Map<string, PendingConnRecord>(),
    activeHosts: new Map<string, (msg: object) => void>()
  }

  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 })

  const requestHandler = createOwnMobileRelayRequestHandler({
    operator,
    configuredClientId,
    authStore,
    issued,
    advertisedOriginCallback: () => advertisedOrigin,
    router
  })

  const server = createServer((request, response) => {
    void requestHandler(request, response)
  })

  server.on(
    'upgrade',
    registerOwnMobileRelayUpgrades(wss, {
      issued,
      activeSockets,
      advertisedOriginCallback: () => advertisedOrigin,
      silenceLimitMs,
      router
    })
  )

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(listenPort, listenHost, () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('own_mobile_relay_bind_failed'))
        return
      }
      const hasPort =
        /:\d+$/.test(options.origin) ||
        /:\d+\//.test(options.origin) ||
        Boolean(new URL(options.origin).port)

      if (
        hasPort ||
        options.origin === 'http://127.0.0.1' ||
        options.origin === 'http://localhost'
      ) {
        const advertised = new URL(options.origin)
        advertised.port = String(address.port)
        advertisedOrigin = advertised.origin
      } else {
        advertisedOrigin = options.origin
      }
      resolve({
        origin: advertisedOrigin,
        boundPort: address.port,
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
