import type { IncomingMessage, ServerResponse } from 'node:http'
import { ReadBodyError, readUrlEncodedBodySafely } from './own-mobile-relay-http-utils'
import {
  isAuthOriginAllowed,
  type OwnMobileRelayOperatorRequestContext
} from './own-mobile-relay-operator-routes'
import { loginOperatorAccount } from './own-mobile-relay-operator-auth'
import {
  ADMIN_PAGE_HEADERS,
  renderAdminEvents,
  renderAdminIncident,
  renderAdminLogin,
  renderAdminOverview,
  renderAdminPairing
} from './own-mobile-relay-admin-pages'
import { buildOperatorIncidentBundle } from './own-mobile-relay-operator-bundle'
import {
  loadOperatorConsoleState,
  revokeOperatorDevice,
  revokeOperatorGrant
} from './own-mobile-relay-operator-actions'

export const OPERATOR_COOKIE_NAME = 'own_relay_operator'
const OPERATOR_SESSION_TTL_MS = 24 * 60 * 60 * 1000

function sendHtml(
  response: ServerResponse,
  status: number,
  html: string,
  extra?: Record<string, string>
): void {
  const payload = Buffer.from(html)
  response.writeHead(status, {
    ...ADMIN_PAGE_HEADERS,
    'content-length': payload.byteLength,
    ...extra
  })
  response.end(payload)
}

function redirect(
  response: ServerResponse,
  location: string,
  extra?: Record<string, string>
): void {
  response.writeHead(303, { location, ...extra })
  response.end()
}

function cookieValue(header: string | string[] | undefined): string | null {
  const raw = Array.isArray(header) ? header.join('; ') : header
  if (!raw) {
    return null
  }
  for (const part of raw.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === OPERATOR_COOKIE_NAME) {
      const value = rest.join('=').trim()
      return value || null
    }
  }
  return null
}

function setOperatorCookie(token: string): string {
  return `${OPERATOR_COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/admin; Max-Age=${Math.floor(OPERATOR_SESSION_TTL_MS / 1000)}`
}

function clearOperatorCookie(): string {
  return `${OPERATOR_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/admin; Max-Age=0`
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value
  if (typeof raw !== 'string') {
    return undefined
  }
  const trimmed = raw.trim()
  return trimmed || undefined
}

function canonicalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

function originHeader(request: IncomingMessage): string | undefined {
  const origin = firstHeaderValue(request.headers.origin)
  if (!origin || origin === 'null') {
    return undefined
  }
  return canonicalizeOrigin(origin)
}

function isAdminCsrfAllowed(request: IncomingMessage, authOrigin: string): boolean {
  const allowed = canonicalizeOrigin(authOrigin)
  const origin = originHeader(request)
  if (origin) {
    return origin === allowed
  }
  const fetchSite = firstHeaderValue(request.headers['sec-fetch-site'])
  if (fetchSite === 'same-origin') {
    return true
  }
  const referer = firstHeaderValue(request.headers.referer)
  if (!referer) {
    return false
  }
  try {
    return canonicalizeOrigin(new URL(referer).origin) === allowed
  } catch {
    return false
  }
}

export async function handleAdminRequest(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  context: OwnMobileRelayOperatorRequestContext
): Promise<void> {
  const authOrigin = context.authOriginCallback
    ? context.authOriginCallback()
    : context.advertisedOriginCallback()
  if (!isAuthOriginAllowed(request, authOrigin)) {
    response.writeHead(404, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: 'not_found' }))
    return
  }

  const pathname = url.pathname
  if (request.method === 'GET' && pathname === '/admin/login') {
    sendHtml(response, 200, renderAdminLogin())
    return
  }

  if (request.method === 'POST' && pathname === '/admin/login') {
    if (!isAdminCsrfAllowed(request, authOrigin)) {
      sendHtml(
        response,
        403,
        renderAdminLogin('Open this page on the auth origin and sign in from that form.')
      )
      return
    }
    let body: URLSearchParams
    try {
      body = await readUrlEncodedBodySafely(request)
    } catch (err) {
      if (err instanceof ReadBodyError && err.code === 'payload_too_large') {
        response.writeHead(413, { 'content-type': 'text/plain' })
        response.end('Payload Too Large')
        return
      }
      sendHtml(response, 400, renderAdminLogin('Bad request'))
      return
    }
    const result = await loginOperatorAccount(
      request,
      body.get('email') ?? '',
      body.get('password') ?? '',
      {
        securityState: context.securityState,
        throttle: context.throttle,
        passwordPolicy: context.passwordPolicy,
        auditLog: context.auditLog
      }
    )
    if (!result.ok) {
      sendHtml(response, result.status === 429 ? 429 : 401, renderAdminLogin('Invalid credentials'))
      return
    }
    redirect(response, '/admin', { 'set-cookie': setOperatorCookie(result.token) })
    return
  }

  const token = cookieValue(request.headers.cookie)
  const session = token ? await context.securityState.lookupOperatorSession(token) : null
  if (!session) {
    response.writeHead(302, { location: '/admin/login' })
    response.end()
    return
  }

  if (request.method === 'POST' && pathname === '/admin/logout') {
    await context.securityState.revokeOperatorSession(token ?? '')
    redirect(response, '/admin/login', { 'set-cookie': clearOperatorCookie() })
    return
  }

  if (request.method === 'GET' && pathname === '/admin') {
    const state = await loadOperatorConsoleState(context)
    sendHtml(
      response,
      200,
      renderAdminOverview({
        hostControlLive: state.hostControlLive,
        sessions: state.sessions.length,
        grants: state.grants.length,
        devices: state.devices.length,
        events: state.events.length
      })
    )
    return
  }

  if (request.method === 'GET' && pathname === '/admin/events') {
    const events = context.auditLog ? await context.auditLog.list({ order: 'desc' }) : []
    sendHtml(response, 200, renderAdminEvents(events))
    return
  }

  if (request.method === 'GET' && pathname === '/admin/pairing') {
    const now = Date.now()
    const [devices, grants] = await Promise.all([
      context.securityState.listDeviceCredentials(),
      context.securityState.listRelayGrants(now)
    ])
    sendHtml(response, 200, renderAdminPairing({ devices, grants }))
    return
  }

  if (request.method === 'GET' && pathname === '/admin/incident') {
    const bundle = buildOperatorIncidentBundle(await loadOperatorConsoleState(context))
    sendHtml(
      response,
      200,
      renderAdminIncident({
        markdown: bundle.markdown,
        jsonText: JSON.stringify(bundle, null, 2)
      })
    )
    return
  }

  const deviceRevoke = pathname.match(/^\/admin\/pairing\/devices\/([^/]+)\/([^/]+)\/revoke$/)
  const grantRevoke = pathname.match(/^\/admin\/pairing\/grants\/([^/]+)\/revoke$/)
  const hostKeyExpiry = pathname.match(/^\/admin\/pairing\/hosts\/([^/]+)\/key-expiry$/)
  const deviceKeyExpiry = pathname.match(
    /^\/admin\/pairing\/devices\/([^/]+)\/([^/]+)\/key-expiry$/
  )

  if (
    request.method === 'POST' &&
    (deviceRevoke || grantRevoke || hostKeyExpiry || deviceKeyExpiry)
  ) {
    if (!isAdminCsrfAllowed(request, authOrigin)) {
      sendHtml(response, 403, '<!DOCTYPE html><html><body>Forbidden</body></html>')
      return
    }
    if (deviceRevoke) {
      await revokeOperatorDevice(
        context,
        decodeURIComponent(deviceRevoke[1] ?? ''),
        decodeURIComponent(deviceRevoke[2] ?? '')
      )
    } else if (grantRevoke) {
      await revokeOperatorGrant(context, decodeURIComponent(grantRevoke[1] ?? ''))
    } else if (hostKeyExpiry || deviceKeyExpiry) {
      let form: URLSearchParams
      try {
        form = await readUrlEncodedBodySafely(request)
      } catch {
        sendHtml(response, 400, 'Bad request')
        return
      }
      const disabled = form.get('disabled') === 'true'
      if (hostKeyExpiry) {
        await context.securityState.setHostKeyExpiryDisabled(
          decodeURIComponent(hostKeyExpiry[1] ?? ''),
          disabled
        )
      } else if (deviceKeyExpiry) {
        await context.securityState.setDeviceKeyExpiryDisabled(
          decodeURIComponent(deviceKeyExpiry[1] ?? ''),
          decodeURIComponent(deviceKeyExpiry[2] ?? ''),
          disabled
        )
      }
    }
    redirect(response, '/admin/pairing')
    return
  }

  response.writeHead(404, { 'content-type': 'text/plain' })
  response.end('Not found')
}
