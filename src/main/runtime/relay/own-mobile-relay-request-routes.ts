import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { bearerToken, readJsonBody, sendJson } from './own-mobile-relay-http-utils'
import type { OwnMobileRelayRouter } from './own-mobile-relay-splice-handler'
import { handleResolvePost } from './own-mobile-relay-resolve-handler'
import type { OwnMobileRelayAuthStore } from './own-mobile-relay-auth'
import type {
  OwnMobileRelaySecurityState,
  SecurityStateAccessSession
} from './own-mobile-relay-security-state'
import {
  handleAuthorizeGet,
  handleAuthorizePost,
  handleCapabilities,
  handleLogoutPost,
  handleProfile,
  handleRefreshPost,
  handleSessionPost,
  handlePasswordGet,
  handlePasswordPost
} from './own-mobile-relay-auth'
import type { AuthThrottle } from './own-mobile-relay-auth-throttle'
import type { PasswordPolicy } from './own-mobile-relay-password'

const RELAY_TOKEN_TTL_MS = 60 * 60 * 1000

export type OwnMobileRelayRequestContext = {
  securityState: OwnMobileRelaySecurityState
  configuredClientId: string
  authStore: OwnMobileRelayAuthStore
  advertisedOriginCallback: () => string
  authOriginCallback?: () => string
  router: OwnMobileRelayRouter
  throttle?: AuthThrottle
  passwordPolicy?: PasswordPolicy
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
    if (url.pathname === '/v1/desktop/auth/password') {
      if (request.method === 'GET') {
        handlePasswordGet(response)
        return
      }
      if (request.method === 'POST') {
        const authOrigin = context.authOriginCallback
          ? context.authOriginCallback()
          : context.advertisedOriginCallback()
        await handlePasswordPost(
          request,
          context.securityState,
          authOrigin,
          response,
          context.throttle,
          context.passwordPolicy,
          context.advertisedOriginCallback()
        )
        return
      }
    }
    if (url.pathname === '/v1/desktop/auth/authorize') {
      if (request.method === 'GET') {
        handleAuthorizeGet(url, context.configuredClientId, response)
        return
      }
      if (request.method === 'POST') {
        await handleAuthorizePost(
          request,
          url,
          context.securityState,
          context.configuredClientId,
          context.authStore,
          response,
          context.throttle,
          context.passwordPolicy
        )
        return
      }
    }
    if (request.method === 'POST' && url.pathname === '/v1/desktop/auth/session') {
      const body = await readJsonBodySafely(request, response)
      if (body === undefined) {
        return
      }
      await handleSessionPost(body, context.securityState, context.authStore, response)
      return
    }
    if (request.method === 'POST' && url.pathname === '/v1/desktop/auth/refresh') {
      const body = await readJsonBodySafely(request, response)
      if (body === undefined) {
        return
      }
      await handleRefreshPost(body, context.securityState, context.authStore, response)
      return
    }
    if (
      (request.method === 'GET' || request.method === 'POST') &&
      url.pathname === '/v1/desktop/auth/capabilities'
    ) {
      const session = await lookupSession(request, context.securityState)
      if (!session) {
        sendJson(response, 401, { error: 'unauthorized' })
        return
      }
      handleCapabilities(session, response)
      return
    }
    if (request.method === 'GET' && url.pathname === '/v1/desktop/auth/profile') {
      const session = await lookupSession(request, context.securityState)
      if (!session) {
        sendJson(response, 401, { error: 'unauthorized' })
        return
      }
      handleProfile(session, response)
      return
    }
    if (request.method === 'POST' && url.pathname === '/v1/desktop/auth/logout') {
      const session = await lookupSession(request, context.securityState)
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
      await handleLogoutPost(session, body, context.securityState, context.authStore, response)
      return
    }
    if (request.method === 'POST' && url.pathname === '/v1/desktop/auth/relay-token') {
      const session = await lookupSession(request, context.securityState)
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
      const rawRelayToken = randomBytes(32).toString('base64url')
      const issuedGrant = await context.securityState.issueRelayGrant({
        rawRelayToken,
        parentSessionId: session.sessionId,
        relayHostId: record.relayHostId,
        hostPublicKeyB64: record.hostPublicKeyB64,
        identity: {
          userId: session.identity.userId,
          profileId: session.identity.cloudProfileId,
          organizationId: session.identity.organizationId
        },
        ttlMs: RELAY_TOKEN_TTL_MS
      })
      if (!issuedGrant) {
        sendJson(response, 401, { error: 'unauthorized' })
        return
      }
      sendJson(response, 200, {
        relayToken: rawRelayToken,
        expiresAt: issuedGrant.expiresAt
      })
      return
    }
    if (request.method === 'POST' && url.pathname === '/v1/assign') {
      const relayToken = bearerToken(request.headers.authorization)
      const grant = relayToken
        ? await context.securityState.validateRelayGrantByToken(relayToken)
        : null
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
      await handleResolvePost(
        body,
        context.advertisedOriginCallback(),
        context.securityState,
        response
      )
      return
    }
    sendJson(response, 404, { error: 'not_found' })
  }
}

async function readJsonBodySafely(
  request: IncomingMessage,
  response: ServerResponse
): Promise<unknown> {
  try {
    return await readJsonBody(request)
  } catch {
    sendJson(response, 400, { error: 'invalid_json' })
    return undefined
  }
}

async function lookupSession(
  request: IncomingMessage,
  securityState: OwnMobileRelaySecurityState
): Promise<SecurityStateAccessSession | null> {
  const access = bearerToken(request.headers.authorization)
  if (!access) {
    return null
  }
  return securityState.lookupAccessSessionByToken(access)
}
