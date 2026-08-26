import { createServer } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import type {
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
import { createOwnMobileRelaySecurityStateMemory } from './own-mobile-relay-security-state-memory'
import type { OwnMobileRelaySecurityState } from './own-mobile-relay-security-state'
import { bootstrapOperatorAccount } from './own-mobile-relay-account'
import { TEST_FAST_PASSWORD_POLICY, type PasswordPolicy } from './own-mobile-relay-password'

export type OwnMobileRelayListenOptions = {
  operator?: OwnMobileRelayOperatorConfig
  securityState?: OwnMobileRelaySecurityState
  clientId?: string
  origin: string
  listenHost?: string
  listenPort?: number
  silenceLimitMs?: number
  passwordPolicy?: PasswordPolicy
}

export type OwnMobileRelayServer = {
  origin: string
  boundPort: number
  close: () => Promise<void>
}

const DEFAULT_SILENCE_LIMIT_MS = 15_000

export async function listenOwnMobileRelay(
  options: OwnMobileRelayListenOptions
): Promise<OwnMobileRelayServer> {
  const activeSockets = new Set<WebSocket>()
  const authStore: OwnMobileRelayAuthStore = createOwnMobileRelayAuthStore()
  let advertisedOrigin = options.origin
  const silenceLimitMs = options.silenceLimitMs ?? DEFAULT_SILENCE_LIMIT_MS
  const configuredClientId = options.clientId ?? 'orca-desktop'
  const listenHost = options.listenHost ?? '127.0.0.1'
  const listenPort = options.listenPort ?? 0

  let securityState = options.securityState
  const ownsSecurityState = !securityState
  const passwordPolicy = options.passwordPolicy ?? TEST_FAST_PASSWORD_POLICY

  if (!securityState) {
    securityState = createOwnMobileRelaySecurityStateMemory()
  }
  if (options.operator) {
    await bootstrapOperatorAccount(securityState, options.operator, passwordPolicy)
  }

  const router: OwnMobileRelayRouter = {
    invites: new Map<string, OwnMobileRelayInviteRecord>(),
    pendingConns: new Map<string, PendingConnRecord>(),
    connsByTicket: new Map<string, PendingConnRecord>(),
    activeHosts: new Map<string, (msg: object) => void>()
  }

  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 })

  const requestHandler = createOwnMobileRelayRequestHandler({
    securityState,
    configuredClientId,
    authStore,
    advertisedOriginCallback: () => advertisedOrigin,
    router,
    passwordPolicy
  })

  const server = createServer((request, response) => {
    void requestHandler(request, response)
  })

  server.on(
    'upgrade',
    registerOwnMobileRelayUpgrades(wss, {
      securityState,
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
              server.close(async (error) => {
                if (ownsSecurityState && securityState) {
                  try {
                    await securityState.close()
                  } catch {
                    // Ignore adapter close error
                  }
                }
                if (error) {
                  closeReject(error)
                } else {
                  closeResolve()
                }
              })
            })
          })
      })
    })
  })
}
