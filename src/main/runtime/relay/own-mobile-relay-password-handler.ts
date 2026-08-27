import type { IncomingMessage, ServerResponse } from 'node:http'
import type { OwnMobileRelaySecurityState } from './own-mobile-relay-security-state'
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
import { readUrlEncodedBodySafely, ReadBodyError } from './own-mobile-relay-http-utils'

export function handlePasswordGet(response: ServerResponse): void {
  const html = renderPasswordChangePage()
  response.writeHead(200, {
    ...PASSWORD_PAGE_HEADERS,
    'content-length': Buffer.byteLength(html)
  })
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

export async function handlePasswordPost(
  request: IncomingMessage,
  securityState: OwnMobileRelaySecurityState,
  configuredOrigin: string,
  response: ServerResponse,
  throttle?: AuthThrottle,
  passwordPolicy: PasswordPolicy = CURRENT_PASSWORD_POLICY
): Promise<void> {
  const originHeader = request.headers.origin
  if (!originHeader || originHeader !== configuredOrigin) {
    response.writeHead(403, { 'content-type': 'text/plain' })
    response.end('Forbidden')
    return
  }

  const secFetchSite = request.headers['sec-fetch-site']
  if (secFetchSite === 'cross-site') {
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

  const email = body.get('email') ?? ''
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

  const account = await securityState.getAccount()
  const passwordRec = await securityState.getAccountPasswordRecord()

  if (!account || !passwordRec || email !== account.email) {
    if (throttle) {
      throttle.recordFailure(email, remoteIp)
    }
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
    if (throttle) {
      throttle.recordFailure(email, remoteIp)
    }
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

  const replaceResult = await securityState.replacePasswordVerifier({
    expectedVerifierVersion: passwordRec.verifierVersion,
    newPasswordRecord
  })

  if (!replaceResult.ok) {
    if (throttle) {
      throttle.recordFailure(email, remoteIp)
    }
    sendPasswordPageResponse(response, 401, {
      status: 'error',
      message: 'Authentication failed. Please verify your current credentials.'
    })
    return
  }

  if (throttle) {
    throttle.recordSuccess(email, remoteIp)
  }

  sendPasswordPageResponse(response, 200, {
    status: 'success',
    message: 'Password changed successfully. Active desktop sessions have been invalidated.'
  })
}
