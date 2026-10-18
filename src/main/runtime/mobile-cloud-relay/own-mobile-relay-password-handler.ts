import type { IncomingMessage, ServerResponse } from 'node:http'
import type {
  OwnMobileRelaySecurityState,
  SecurityStateAccessSession
} from './own-mobile-relay-security-state'
import {
  verifyPasswordRecord,
  derivePasswordRecord,
  validatePasswordCandidate,
  CURRENT_PASSWORD_POLICY,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
  type PasswordPolicy
} from './own-mobile-relay-password'
import { PASSWORD_PAGE_HEADERS, renderPasswordChangePage } from './own-mobile-relay-password-page'
import type { AuthThrottle } from './own-mobile-relay-auth-throttle'
import { bearerToken, readUrlEncodedBodySafely, ReadBodyError } from './own-mobile-relay-http-utils'

export const PASSWORD_COOKIE_NAME = 'own_relay_password'
export const PASSWORD_COOKIE_PATH = '/v1/desktop/auth/password'
const PASSWORD_COOKIE_TTL_MS = 60 * 60 * 1000 // 1 hour

export function setPasswordCookie(token: string): string {
  return `${PASSWORD_COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=${PASSWORD_COOKIE_PATH}; Max-Age=${Math.floor(PASSWORD_COOKIE_TTL_MS / 1000)}`
}

function passwordCookieValue(header: string | string[] | undefined): string | null {
  const raw = Array.isArray(header) ? header.join('; ') : header
  if (!raw) {
    return null
  }
  for (const part of raw.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === PASSWORD_COOKIE_NAME) {
      return rest.join('=').trim() || null
    }
  }
  return null
}

export async function lookupPasswordSession(
  request: IncomingMessage,
  securityState: OwnMobileRelaySecurityState
): Promise<SecurityStateAccessSession | null> {
  const token =
    bearerToken(request.headers.authorization) || passwordCookieValue(request.headers.cookie)
  return token ? securityState.lookupAccessSessionByToken(token) : null
}

export async function handlePasswordCookiePost(
  request: IncomingMessage,
  securityState: OwnMobileRelaySecurityState,
  response: ServerResponse
): Promise<void> {
  const bearer = bearerToken(request.headers.authorization)
  if (!bearer) {
    response.writeHead(401, { 'content-type': 'text/plain' })
    response.end('Unauthorized')
    return
  }
  const session = await securityState.lookupAccessSessionByToken(bearer)
  if (!session) {
    response.writeHead(401, { 'content-type': 'text/plain' })
    response.end('Unauthorized')
    return
  }
  response.writeHead(204, {
    'set-cookie': setPasswordCookie(bearer),
    'cache-control': 'no-store'
  })
  response.end()
}

export async function handlePasswordGet(
  request: IncomingMessage,
  securityState: OwnMobileRelaySecurityState,
  response: ServerResponse
): Promise<void> {
  const session = await lookupPasswordSession(request, securityState)
  if (!session) {
    response.writeHead(401, { 'content-type': 'text/plain' })
    response.end('Unauthorized')
    return
  }
  const html = renderPasswordChangePage()
  response.writeHead(200, { ...PASSWORD_PAGE_HEADERS, 'content-length': Buffer.byteLength(html) })
  response.end(html)
}

function sendPasswordPageResponse(
  response: ServerResponse,
  statusCode: number,
  feedback: { status: 'success' | 'error'; message: string },
  extraHeaders: Record<string, string> = {}
): void {
  const html = renderPasswordChangePage(feedback)
  response.writeHead(statusCode, {
    ...PASSWORD_PAGE_HEADERS,
    ...extraHeaders,
    'content-length': Buffer.byteLength(html)
  })
  response.end(html)
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value
  if (typeof raw !== 'string') {
    return undefined
  }
  const trimmed = raw.trim()
  return !trimmed || trimmed.toLowerCase() === 'null' ? undefined : trimmed.replace(/\/$/, '')
}

function originFromUrl(url: string | undefined): string | undefined {
  if (!url) {
    return undefined
  }
  try {
    return new URL(url).origin
  } catch {
    return undefined
  }
}

function hostMatchesAllowed(
  hostHeader: string | string[] | undefined,
  allowedOrigins: string[]
): boolean {
  const host = firstHeader(hostHeader)
  if (!host) {
    return false
  }
  return allowedOrigins.some((origin) => {
    try {
      const allowed = new URL(origin)
      return allowed.host === host || allowed.hostname === host.split(':')[0]
    } catch {
      return false
    }
  })
}

function isAllowedPasswordOrigin(
  originHeader: string | string[] | undefined,
  refererHeader: string | string[] | undefined,
  hostHeader: string | string[] | undefined,
  allowedOrigins: string[]
): boolean {
  const origin = firstHeader(originHeader)
  if (origin && allowedOrigins.includes(origin)) {
    return true
  }
  const refererOrigin = originFromUrl(firstHeader(refererHeader))
  if (refererOrigin && allowedOrigins.includes(refererOrigin)) {
    return true
  }
  return !origin && hostMatchesAllowed(hostHeader, allowedOrigins)
}

export async function handlePasswordPost(
  request: IncomingMessage,
  securityState: OwnMobileRelaySecurityState,
  configuredOrigin: string,
  response: ServerResponse,
  throttle?: AuthThrottle,
  passwordPolicy: PasswordPolicy = CURRENT_PASSWORD_POLICY,
  advertisedOrigin?: string
): Promise<void> {
  const session = await lookupPasswordSession(request, securityState)
  if (!session) {
    response.writeHead(401, { 'content-type': 'text/plain' })
    response.end('Unauthorized')
    return
  }

  const allowedOrigins = [configuredOrigin, advertisedOrigin].filter((value): value is string =>
    Boolean(value)
  )
  if (
    !isAllowedPasswordOrigin(
      request.headers.origin,
      request.headers.referer,
      request.headers.host,
      allowedOrigins
    )
  ) {
    response.writeHead(403, { 'content-type': 'text/plain' })
    response.end('Forbidden')
    return
  }

  const contentType = request.headers['content-type'] ?? ''
  if (!contentType.includes('application/x-www-form-urlencoded')) {
    response.writeHead(415, { 'content-type': 'text/plain' })
    response.end('Unsupported Media Type')
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
    response.writeHead(400, { 'content-type': 'text/plain' })
    response.end('Bad Request')
    return
  }

  const email = session.identity.email
  const currentPassword = body.get('currentPassword') ?? ''
  const newPassword = body.get('newPassword') ?? ''
  const confirmPassword = body.get('confirmPassword') ?? ''
  const remoteIp = request.socket?.remoteAddress

  if (throttle) {
    const throttleCheck = throttle.check(email, remoteIp)
    if (!throttleCheck.allowed) {
      sendPasswordPageResponse(
        response,
        429,
        {
          status: 'error',
          message: 'Too many failed attempts. Please wait before retrying.'
        },
        { 'retry-after': String(throttleCheck.retryAfterSeconds) }
      )
      return
    }
  }

  if (newPassword !== confirmPassword) {
    sendPasswordPageResponse(response, 400, {
      status: 'error',
      message: 'Password confirmation does not match.'
    })
    return
  }

  if (!validatePasswordCandidate(newPassword)) {
    sendPasswordPageResponse(response, 400, {
      status: 'error',
      message: `New password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters.`
    })
    return
  }

  const account = await securityState.getAccount({ accountId: session.accountId })
  const passwordRec = await securityState.getAccountPasswordRecord(session.accountId)

  if (!account || !passwordRec || account.status !== 'active') {
    throttle?.recordFailure(email, remoteIp)
    sendPasswordPageResponse(response, 401, {
      status: 'error',
      message: 'Authentication failed. Please verify your current credentials.'
    })
    return
  }

  const verifyResult = await verifyPasswordRecord(
    currentPassword,
    passwordRec.passwordRecord,
    passwordPolicy
  )
  if (!verifyResult.valid) {
    throttle?.recordFailure(email, remoteIp)
    sendPasswordPageResponse(response, 401, {
      status: 'error',
      message: 'Authentication failed. Please verify your current credentials.'
    })
    return
  }

  let newPasswordRecord
  try {
    newPasswordRecord = await derivePasswordRecord(newPassword, passwordPolicy)
  } catch {
    sendPasswordPageResponse(response, 400, {
      status: 'error',
      message: 'Invalid password format.'
    })
    return
  }

  const replaceResult = await securityState.replacePasswordVerifier(account.accountId, {
    expectedVerifierVersion: passwordRec.verifierVersion,
    newPasswordRecord
  })

  if (!replaceResult.ok) {
    throttle?.recordFailure(email, remoteIp)
    sendPasswordPageResponse(response, 401, {
      status: 'error',
      message: 'Authentication failed. Please verify your current credentials.'
    })
    return
  }

  throttle?.recordSuccess(email, remoteIp)

  sendPasswordPageResponse(response, 200, {
    status: 'success',
    message: 'Password changed successfully. Active desktop sessions have been invalidated.'
  })
}
