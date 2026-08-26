import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { bearerToken, readJsonBody, sendJson } from './own-mobile-relay-http-utils'
import type { OwnMobileRelayRouter } from './own-mobile-relay-splice-handler'
import { handleResolvePost } from './own-mobile-relay-resolve-handler'
import type {
  OwnMobileRelayIssuedToken,
  OwnMobileRelayListenOptions
} from './own-mobile-relay-http'
import type { OwnMobileRelayAuthStore } from './own-mobile-relay-auth'
import {
  handleAuthorizeGet,
  handleAuthorizePost,
  handleCapabilities,
  handleLogoutPost,
  handleProfile,
  handleRefreshPost,
  handleSessionPost
} from './own-mobile-relay-auth'

const RELAY_TOKEN_TTL_MS = 60 * 60 * 1000

export type OwnMobileRelayRequestContext = {
  operator: OwnMobileRelayListenOptions['operator']
  configuredClientId: string
  authStore: OwnMobileRelayAuthStore
  issued: Map<string, OwnMobileRelayIssuedToken>
  advertisedOriginCallback: () => string
  router: OwnMobileRelayRouter
}

export function createOwnMobileRelayRequestHandler(
  context: OwnMobileRelayRequestContext
): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  return async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (request.method === 'GET' && url.pathname === '/health') {
      sendJson(response, 200, { ok: true })
      return
    }
    if (url.pathname === '/v1/desktop/auth/authorize') {
      if (request.method === 'GET') {
        handleAuthorizeGet(url, context.configuredClientId, response)
        return
      }
      if (request.method === 'POST') {
        if (!context.operator) {
          sendJson(response, 500, { error: 'operator_not_configured' })
          return
        }
        await handleAuthorizePost(
          request,
          url,
          context.operator,
          context.configuredClientId,
          context.authStore,
          response
        )
        return
      }
    }
    if (request.method === 'POST' && url.pathname === '/v1/desktop/auth/session') {
      const body = await readJsonBodySafely(request, response)
      if (body === undefined) {
        return
      }
      handleSessionPost(body, context.authStore, response)
      return
    }
    if (request.method === 'POST' && url.pathname === '/v1/desktop/auth/refresh') {
      const body = await readJsonBodySafely(request, response)
      if (body === undefined) {
        return
      }
      handleRefreshPost(body, context.authStore, response)
      return
    }
    if (
      (request.method === 'GET' || request.method === 'POST') &&
      url.pathname === '/v1/desktop/auth/capabilities'
    ) {
      const session = lookupSession(request, context.authStore)
      if (!session) {
        sendJson(response, 401, { error: 'unauthorized' })
        return
      }
      handleCapabilities(session, response)
      return
    }
    if (request.method === 'GET' && url.pathname === '/v1/desktop/auth/profile') {
      const session = lookupSession(request, context.authStore)
      if (!session) {
        sendJson(response, 401, { error: 'unauthorized' })
        return
      }
      handleProfile(session, response)
      return
    }
    if (request.method === 'POST' && url.pathname === '/v1/desktop/auth/logout') {
      const session = lookupSession(request, context.authStore)
      if (!session) {
        sendJson(response, 401, { error: 'unauthorized' })
        return
      }
      let body: unknown
      try {
        body = await readJsonBody(request)
      } catch {
        // Body is optional for logout
        body = null
      }
      handleLogoutPost(session, body, context.authStore, response)
      return
    }
    if (request.method === 'POST' && url.pathname === '/v1/desktop/auth/relay-token') {
      const session = lookupSession(request, context.authStore)
      if (!session) {
        sendJson(response, 401, { error: 'unauthorized' })
        return
      }
      const body = await readJsonBodySafely(request, response)
      if (body === undefined) {
        return
      }
      const record = body as { relayHostId?: unknown; hostPublicKeyB64?: unknown }
      if (typeof record.relayHostId !== 'string' || typeof record.hostPublicKeyB64 !== 'string') {
        sendJson(response, 400, { error: 'invalid_request' })
        return
      }
      const relayToken = randomBytes(32).toString('base64url')
      context.issued.set(relayToken, {
        relayHostId: record.relayHostId,
        hostPublicKeyB64: record.hostPublicKeyB64,
        identity: {
          userId: session.identity.userId,
          profileId: session.identity.cloudProfileId,
          organizationId: session.identity.organizationId
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
      const grant = relayToken ? context.issued.get(relayToken) : undefined
      if (!grant) {
        sendJson(response, 401, { error: 'unauthorized' })
        return
      }
      const body = await readJsonBodySafely(request, response)
      if (body === undefined) {
        return
      }
      const record = body as { v?: unknown; relayHostId?: unknown }
      if (record.v !== 1 || record.relayHostId !== grant.relayHostId) {
        sendJson(response, 400, { error: 'invalid_request' })
        return
      }
      sendJson(response, 200, {
        v: 1,
        cellUrl: context.advertisedOriginCallback(),
        assignmentEpoch: 1,
        lease: randomBytes(32).toString('base64url')
      })
      return
    }
    if (request.method === 'POST' && url.pathname === '/v1/resolve') {
      const body = await readJsonBodySafely(request, response)
      if (body === undefined) {
        return
      }
      handleResolvePost(body, context.advertisedOriginCallback(), context.router, response)
      return
    }
    sendJson(response, 404, { error: 'not_found' })
  }
}

async function readJsonBodySafely(
  request: IncomingMessage,
  response: ServerResponse
): Promise<unknown | undefined> {
  try {
    return await readJsonBody(request)
  } catch {
    sendJson(response, 400, { error: 'invalid_json' })
    return undefined
  }
}

function lookupSession(
  request: IncomingMessage,
  authStore: OwnMobileRelayAuthStore
): ReturnType<OwnMobileRelayAuthStore['sessions']['get']> | undefined {
  const access = bearerToken(request.headers.authorization)
  if (!access) {
    return undefined
  }
  const session = authStore.sessions.get(access)
  if (!session) {
    return undefined
  }
  if (session.expiresAt <= Date.now()) {
    return undefined
  }
  return session
}
