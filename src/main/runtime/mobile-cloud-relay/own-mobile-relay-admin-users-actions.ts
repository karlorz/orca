import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import type { OwnMobileRelayOperatorRequestContext } from './own-mobile-relay-operator-routes'
import type { SecurityStateOperatorSession } from './own-mobile-relay-security-state'
import {
  CURRENT_PASSWORD_POLICY,
  derivePasswordRecord,
  type PasswordPolicy
} from './own-mobile-relay-password'
import { emitAudit } from './own-mobile-relay-audit-emit'
import { readUrlEncodedBodySafely } from './own-mobile-relay-http-utils'
import { renderAdminUsers } from './own-mobile-relay-users-page'

function sendHtml(
  response: ServerResponse,
  status: number,
  html: string,
  extra?: Record<string, string>
): void {
  const payload = Buffer.from(html)
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': payload.byteLength,
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store, max-age=0',
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

export async function handleAdminUsersGet(
  _request: IncomingMessage,
  response: ServerResponse,
  context: OwnMobileRelayOperatorRequestContext,
  session: SecurityStateOperatorSession
): Promise<void> {
  const accounts = context.securityState.listAccounts
    ? await context.securityState.listAccounts()
    : []
  const html = renderAdminUsers(accounts, session.accountId)
  sendHtml(response, 200, html)
}

export async function handleAdminUsersPost(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  context: OwnMobileRelayOperatorRequestContext,
  session: SecurityStateOperatorSession,
  passwordPolicy?: PasswordPolicy
): Promise<void> {
  const policy = passwordPolicy ?? CURRENT_PASSWORD_POLICY
  if (pathname === '/admin/users/invite') {
    let form: URLSearchParams
    try {
      form = await readUrlEncodedBodySafely(request)
    } catch {
      sendHtml(response, 400, 'Bad request')
      return
    }
    const rawEmail = form.get('email')?.trim().toLowerCase()
    if (!rawEmail || !rawEmail.includes('@')) {
      sendHtml(response, 400, 'Invalid email')
      return
    }
    const userId = `usr_${randomBytes(8).toString('hex')}`
    const profileId = `prf_${randomBytes(8).toString('hex')}`
    const organizationId = 'org_default'

    try {
      const invited = await context.securityState.inviteAccount({
        email: rawEmail,
        userId,
        profileId,
        organizationId
      })
      await emitAudit(context.auditLog, 'user.invited', {
        accountId: invited.accountId,
        email: invited.email,
        actorAccountId: session.accountId
      })
      redirect(response, '/admin/users')
      return
    } catch {
      const accounts = context.securityState.listAccounts
        ? await context.securityState.listAccounts()
        : []
      sendHtml(
        response,
        400,
        renderAdminUsers(
          accounts,
          session.accountId,
          'Failed to invite user (email may already exist)'
        )
      )
      return
    }
  }

  const match = pathname.match(/^\/admin\/users\/([^/]+)\/(activate|reset|disable)$/)
  if (!match) {
    response.writeHead(404, { 'content-type': 'text/plain' })
    response.end('Not found')
    return
  }

  const targetAccountId = decodeURIComponent(match[1] ?? '')
  const action = match[2]

  const target = await context.securityState.getAccount({ accountId: targetAccountId })
  if (!target) {
    response.writeHead(404, { 'content-type': 'text/plain' })
    response.end('User not found')
    return
  }

  if (action === 'disable') {
    if (target.accountId === session.accountId) {
      sendHtml(response, 403, 'Forbidden: cannot disable own admin account')
      return
    }
    const disableRes = await context.securityState.disableAccount(target.accountId)
    if (disableRes === 'last_admin') {
      sendHtml(response, 403, 'Forbidden: cannot disable last active admin')
      return
    }
    await emitAudit(context.auditLog, 'user.disabled', {
      accountId: target.accountId,
      email: target.email,
      actorAccountId: session.accountId
    })
    redirect(response, '/admin/users')
    return
  }

  let form: URLSearchParams
  try {
    form = await readUrlEncodedBodySafely(request)
  } catch {
    sendHtml(response, 400, 'Bad request')
    return
  }
  const password = form.get('password') ?? ''
  if (!password || password.length < 8) {
    const accounts = context.securityState.listAccounts
      ? await context.securityState.listAccounts()
      : []
    sendHtml(
      response,
      400,
      renderAdminUsers(accounts, session.accountId, 'Password must be at least 8 characters')
    )
    return
  }

  const pwRecord = await derivePasswordRecord(password, policy)

  if (action === 'activate') {
    if (target.status !== 'invited') {
      sendHtml(response, 409, 'Conflict: user is not invited')
      return
    }
    const actRes = await context.securityState.activateInvitedAccount(target.accountId, pwRecord)
    if (actRes !== 'ok') {
      sendHtml(response, 409, 'Conflict activating account')
      return
    }
    await emitAudit(context.auditLog, 'user.activated', {
      accountId: target.accountId,
      email: target.email,
      actorAccountId: session.accountId
    })
    redirect(response, '/admin/users')
    return
  }

  if (action === 'reset') {
    if (target.status !== 'active') {
      sendHtml(response, 400, 'Bad request: user is not active')
      return
    }
    const replaceRes = await context.securityState.replacePasswordVerifier(target.accountId, {
      expectedVerifierVersion: target.verifierVersion,
      newPasswordRecord: pwRecord
    })
    if (!replaceRes.ok) {
      sendHtml(response, 400, `Failed to reset password: ${replaceRes.error}`)
      return
    }
    await emitAudit(context.auditLog, 'user.password_reset', {
      accountId: target.accountId,
      email: target.email,
      actorAccountId: session.accountId
    })
    redirect(response, '/admin/users')
    return
  }

  response.writeHead(404, { 'content-type': 'text/plain' })
  response.end('Not found')
}
