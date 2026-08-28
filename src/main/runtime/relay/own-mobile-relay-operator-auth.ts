import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import type { OwnMobileRelaySecurityState } from './own-mobile-relay-security-state'
import type { AuthThrottle } from './own-mobile-relay-auth-throttle'
import {
  verifyPasswordRecord,
  derivePasswordRecord,
  CURRENT_PASSWORD_POLICY,
  type PasswordPolicy
} from './own-mobile-relay-password'
import { bearerToken, sendJson } from './own-mobile-relay-http-utils'
import type { OwnMobileRelayAuditLog } from './own-mobile-relay-audit'
import { emitAudit } from './own-mobile-relay-audit-emit'

const OPERATOR_SESSION_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

export type OperatorAuthContext = {
  securityState: OwnMobileRelaySecurityState
  throttle?: AuthThrottle
  passwordPolicy?: PasswordPolicy
  auditLog?: OwnMobileRelayAuditLog
}

export type OperatorLoginResult =
  | { ok: true; token: string; expiresAt: number }
  | { ok: false; status: 401 | 429; retryAfterSeconds?: number }

export async function loginOperatorAccount(
  request: IncomingMessage,
  email: string,
  password: string,
  context: OperatorAuthContext
): Promise<OperatorLoginResult> {
  const remoteIp = request.socket?.remoteAddress
  const actor = email || 'unknown'

  if (context.throttle) {
    const throttleCheck = context.throttle.check(email, remoteIp)
    if (!throttleCheck.allowed) {
      await emitAudit(context.auditLog, 'operator.login.throttled', {
        actor,
        reason: 'rate_limited'
      })
      return { ok: false, status: 429, retryAfterSeconds: throttleCheck.retryAfterSeconds }
    }
  }

  const [account, passwordRec] = await Promise.all([
    context.securityState.getAccount(),
    context.securityState.getAccountPasswordRecord()
  ])
  const policy = context.passwordPolicy ?? CURRENT_PASSWORD_POLICY
  if (!account || !passwordRec || !password || email !== account.email) {
    context.throttle?.recordFailure(email, remoteIp)
    await emitAudit(context.auditLog, 'operator.login.failed', {
      actor,
      reason: 'invalid_credentials'
    })
    return { ok: false, status: 401 }
  }

  const verifyResult = await verifyPasswordRecord(password, passwordRec.passwordRecord, policy)
  if (!verifyResult.valid) {
    context.throttle?.recordFailure(email, remoteIp)
    await emitAudit(context.auditLog, 'operator.login.failed', {
      actor,
      reason: 'invalid_credentials'
    })
    return { ok: false, status: 401 }
  }

  context.throttle?.recordSuccess(email, remoteIp)

  if (verifyResult.needsRehash) {
    try {
      const newRecord = await derivePasswordRecord(password, policy)
      await context.securityState.upgradePasswordVerifier({
        expectedVerifierVersion: passwordRec.verifierVersion,
        newPasswordRecord: newRecord
      })
    } catch {
      // Rehash is best-effort upgrade
    }
  }

  const rawToken = randomBytes(32).toString('base64url')
  const session = await context.securityState.issueOperatorSession({
    rawToken,
    ttlMs: OPERATOR_SESSION_TTL_MS
  })
  await emitAudit(context.auditLog, 'operator.login.success', {
    actor: email,
    sessionId: session.sessionId
  })
  return { ok: true, token: rawToken, expiresAt: session.expiresAt }
}

export async function handleOperatorLoginPost(
  request: IncomingMessage,
  body: unknown,
  context: OperatorAuthContext,
  response: ServerResponse
): Promise<void> {
  const record = (body && typeof body === 'object' ? body : {}) as {
    email?: unknown
    password?: unknown
  }
  const result = await loginOperatorAccount(
    request,
    typeof record.email === 'string' ? record.email : '',
    typeof record.password === 'string' ? record.password : '',
    context
  )
  if (!result.ok) {
    if (result.status === 429) {
      response.writeHead(429, {
        'content-type': 'application/json',
        'retry-after': String(result.retryAfterSeconds ?? 0)
      })
      response.end(JSON.stringify({ error: 'too_many_requests' }))
      return
    }
    sendJson(response, 401, { error: 'unauthorized' })
    return
  }
  sendJson(response, 200, { token: result.token, expiresAt: result.expiresAt })
}

export async function handleOperatorLogoutPost(
  request: IncomingMessage,
  context: OperatorAuthContext,
  response: ServerResponse
): Promise<void> {
  const token = bearerToken(request.headers.authorization)
  if (!token) {
    sendJson(response, 401, { error: 'unauthorized' })
    return
  }

  const session = await context.securityState.lookupOperatorSession(token)
  if (!session) {
    sendJson(response, 401, { error: 'unauthorized' })
    return
  }

  await context.securityState.revokeOperatorSession(token)
  await emitAudit(context.auditLog, 'operator.logout', { sessionId: session.sessionId })
  sendJson(response, 200, { ok: true })
}
