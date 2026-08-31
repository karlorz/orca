import type { IncomingMessage, ServerResponse } from 'node:http'
import { bearerToken, readJsonBody, sendJson } from './own-mobile-relay-http-utils'
import type { OwnMobileRelaySecurityState } from './own-mobile-relay-security-state'
import type { AuthThrottle } from './own-mobile-relay-auth-throttle'
import type { PasswordPolicy } from './own-mobile-relay-password'
import type { OwnMobileRelayAuditLog } from './own-mobile-relay-audit'
import {
  handleOperatorLoginPost,
  handleOperatorLogoutPost,
  type OperatorAuthContext
} from './own-mobile-relay-operator-auth'
import { buildOperatorIncidentBundle } from './own-mobile-relay-operator-bundle'
import {
  loadOperatorConsoleState,
  revokeOperatorDevice,
  revokeOperatorGrant
} from './own-mobile-relay-operator-actions'

export type OwnMobileRelayOperatorRequestContext = {
  securityState: OwnMobileRelaySecurityState
  authOriginCallback?: () => string
  advertisedOriginCallback: () => string
  throttle?: AuthThrottle
  passwordPolicy?: PasswordPolicy
  auditLog?: OwnMobileRelayAuditLog
  hostControlLive?: () => boolean
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value
  if (typeof raw !== 'string') {
    return undefined
  }
  const trimmed = raw.trim()
  return trimmed || undefined
}

export function isAuthOriginAllowed(request: IncomingMessage, allowedAuthOrigin: string): boolean {
  const hostHeader = firstHeader(request.headers.host)
  if (!hostHeader) {
    return false
  }

  let allowedHost: string
  let allowedHostname: string
  try {
    const parsed = new URL(allowedAuthOrigin)
    allowedHost = parsed.host.toLowerCase()
    allowedHostname = parsed.hostname.toLowerCase()
  } catch {
    return false
  }

  const reqHost = hostHeader.toLowerCase()
  const reqHostname = reqHost.split(':')[0]
  if (reqHost === allowedHost || reqHostname === allowedHostname) {
    return true
  }
  return false
}

async function requireOperatorSession(
  request: IncomingMessage,
  securityState: OwnMobileRelaySecurityState,
  response: ServerResponse
): Promise<boolean> {
  const token = bearerToken(request.headers.authorization)
  if (!token) {
    sendJson(response, 401, { error: 'unauthorized' })
    return false
  }
  const session = await securityState.lookupOperatorSession(token)
  if (!session) {
    sendJson(response, 401, { error: 'unauthorized' })
    return false
  }
  return true
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

async function readDisabledFlag(
  request: IncomingMessage,
  response: ServerResponse
): Promise<boolean | undefined> {
  const body = (await readJsonBodySafely(request, response)) as Record<string, unknown> | undefined
  if (body === undefined) {
    return undefined
  }
  if (typeof body.disabled !== 'boolean') {
    sendJson(response, 400, { error: 'invalid_request' })
    return undefined
  }
  return body.disabled
}

export async function handleOperatorRequest(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  context: OwnMobileRelayOperatorRequestContext
): Promise<void> {
  const authOrigin = context.authOriginCallback
    ? context.authOriginCallback()
    : context.advertisedOriginCallback()

  if (!isAuthOriginAllowed(request, authOrigin)) {
    sendJson(response, 404, { error: 'not_found' })
    return
  }

  const authContext: OperatorAuthContext = {
    securityState: context.securityState,
    throttle: context.throttle,
    passwordPolicy: context.passwordPolicy,
    auditLog: context.auditLog
  }

  const pathname = url.pathname

  // POST /v1/operator/login
  if (request.method === 'POST' && pathname === '/v1/operator/login') {
    const body = await readJsonBodySafely(request, response)
    if (body === undefined) {
      return
    }
    await handleOperatorLoginPost(request, body, authContext, response)
    return
  }

  // POST /v1/operator/logout
  if (request.method === 'POST' && pathname === '/v1/operator/logout') {
    await handleOperatorLogoutPost(request, authContext, response)
    return
  }

  // All other endpoints require operator session authentication
  const authorized = await requireOperatorSession(request, context.securityState, response)
  if (!authorized) {
    return
  }

  // GET /v1/operator/overview
  if (request.method === 'GET' && pathname === '/v1/operator/overview') {
    const state = await loadOperatorConsoleState(context)
    sendJson(response, 200, {
      ok: true,
      hostControlLive: state.hostControlLive,
      counts: {
        sessions: state.sessions.length,
        grants: state.grants.length,
        devices: state.devices.length,
        events: state.events.length
      }
    })
    return
  }

  // GET /v1/operator/events
  if (request.method === 'GET' && pathname === '/v1/operator/events') {
    if (!context.auditLog) {
      sendJson(response, 200, { events: [] })
      return
    }

    const sinceParam = url.searchParams.get('since')
    const typeParam = url.searchParams.get('type')
    const limitParam = url.searchParams.get('limit')
    const orderParam = url.searchParams.get('order')

    if (orderParam !== null && orderParam !== 'asc' && orderParam !== 'desc') {
      sendJson(response, 400, { error: 'invalid_request' })
      return
    }

    const since = sinceParam ? Number(sinceParam) : undefined
    const type = typeParam ? typeParam : undefined
    const limit = limitParam ? Number(limitParam) : undefined
    const order = (orderParam as 'asc' | 'desc' | null) ?? 'desc'

    const events = await context.auditLog.list({
      ...(since !== undefined && !Number.isNaN(since) ? { since } : {}),
      ...(type !== undefined ? { type } : {}),
      ...(limit !== undefined && !Number.isNaN(limit) ? { limit } : {}),
      order
    })

    sendJson(response, 200, { events })
    return
  }

  // GET /v1/operator/pairing
  if (request.method === 'GET' && pathname === '/v1/operator/pairing') {
    const now = Date.now()
    const [devices, grants] = await Promise.all([
      context.securityState.listDeviceCredentials(),
      context.securityState.listRelayGrants(now)
    ])
    sendJson(response, 200, { devices, grants })
    return
  }

  // POST /v1/operator/pairing/devices/:relayHostId/:deviceId/revoke
  const devRevokeMatch = pathname.match(
    /^\/v1\/operator\/pairing\/devices\/([^/]+)\/([^/]+)\/revoke$/
  )
  if (request.method === 'POST' && devRevokeMatch) {
    await revokeOperatorDevice(
      context,
      decodeURIComponent(devRevokeMatch[1]),
      decodeURIComponent(devRevokeMatch[2])
    )
    sendJson(response, 200, { ok: true })
    return
  }

  // POST /v1/operator/pairing/grants/:grantId/revoke
  const grantRevokeMatch = pathname.match(/^\/v1\/operator\/pairing\/grants\/([^/]+)\/revoke$/)
  if (request.method === 'POST' && grantRevokeMatch) {
    const success = await revokeOperatorGrant(context, decodeURIComponent(grantRevokeMatch[1]))
    if (!success) {
      sendJson(response, 404, { error: 'not_found' })
      return
    }
    sendJson(response, 200, { ok: true })
    return
  }

  // POST /v1/operator/pairing/hosts/:relayHostId/key-expiry
  const hostKeyExpiryMatch = pathname.match(/^\/v1\/operator\/pairing\/hosts\/([^/]+)\/key-expiry$/)
  if (request.method === 'POST' && hostKeyExpiryMatch) {
    const disabled = await readDisabledFlag(request, response)
    if (disabled === undefined) {
      return
    }
    const relayHostId = decodeURIComponent(hostKeyExpiryMatch[1])
    await context.securityState.setHostKeyExpiryDisabled(relayHostId, disabled)
    sendJson(response, 200, { ok: true, relayHostId, keyExpiryDisabled: disabled })
    return
  }

  // POST /v1/operator/pairing/devices/:relayHostId/:deviceId/key-expiry
  const devKeyExpiryMatch = pathname.match(
    /^\/v1\/operator\/pairing\/devices\/([^/]+)\/([^/]+)\/key-expiry$/
  )
  if (request.method === 'POST' && devKeyExpiryMatch) {
    const disabled = await readDisabledFlag(request, response)
    if (disabled === undefined) {
      return
    }
    const relayHostId = decodeURIComponent(devKeyExpiryMatch[1])
    const relayDeviceId = decodeURIComponent(devKeyExpiryMatch[2])
    await context.securityState.setDeviceKeyExpiryDisabled(relayHostId, relayDeviceId, disabled)
    sendJson(response, 200, { ok: true, relayHostId, relayDeviceId, keyExpiryDisabled: disabled })
    return
  }

  // GET /v1/operator/incident-bundle
  if (request.method === 'GET' && pathname === '/v1/operator/incident-bundle') {
    sendJson(response, 200, buildOperatorIncidentBundle(await loadOperatorConsoleState(context)))
    return
  }

  sendJson(response, 404, { error: 'not_found' })
}
