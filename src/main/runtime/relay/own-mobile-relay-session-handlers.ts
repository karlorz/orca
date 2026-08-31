import { randomBytes } from 'node:crypto'
import type { ServerResponse } from 'node:http'
import type { OwnMobileRelayAuthStore } from './own-mobile-relay-auth-store'
import type {
  OwnMobileRelaySecurityState,
  SecurityStateAccessSession
} from './own-mobile-relay-security-state'

const SESSION_TTL_MS = 60 * 60 * 1000

function buildDesktopAuthBody(
  identity: SecurityStateAccessSession['identity'],
  cloudProfileId: string,
  now: number
) {
  return {
    cloud: {
      cloudProfileId,
      userId: identity.userId,
      email: identity.email,
      displayName: undefined,
      activeOrgId: identity.organizationId || undefined,
      activeOrgName: undefined,
      linkedAt: now
    },
    organizations: identity.organizationId
      ? [
          {
            orgId: identity.organizationId,
            name: 'Personal',
            role: 'owner'
          }
        ]
      : [],
    capabilities: {
      flags: {
        'relay.use': true
      },
      refreshedAt: now
    }
  }
}

export async function handleRefreshPost(
  body: unknown,
  securityState: OwnMobileRelaySecurityState,
  _store: OwnMobileRelayAuthStore,
  response: ServerResponse
): Promise<void> {
  if (!body || typeof body !== 'object') {
    response.writeHead(400, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: 'invalid_request' }))
    return
  }

  const record = body as Record<string, unknown>
  const oldRefreshToken = typeof record.refreshToken === 'string' ? record.refreshToken : ''
  if (!oldRefreshToken) {
    response.writeHead(400, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: 'invalid_request' }))
    return
  }

  const now = Date.now()
  const lookup = await securityState.lookupRefreshToken(oldRefreshToken, now)
  if (!lookup) {
    response.writeHead(401, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: 'invalid_grant' }))
    return
  }

  const newAccessToken = randomBytes(32).toString('base64url')
  const newRefreshToken = randomBytes(32).toString('base64url')

  const issued = await securityState.rotateRefreshToken({
    oldRawRefreshToken: oldRefreshToken,
    newRawRefreshToken: newRefreshToken,
    newRawAccessToken: newAccessToken,
    accessTtlMs: SESSION_TTL_MS,
    refreshTtlMs: null
  }, now)

  if (!issued) {
    response.writeHead(401, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: 'invalid_grant' }))
    return
  }

  const payload = {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    expiresAt: issued.expiresAt,
    ...buildDesktopAuthBody(issued.identity, lookup.cloudProfileId, now)
  }

  const data = Buffer.from(JSON.stringify(payload))
  response.writeHead(200, {
    'content-type': 'application/json',
    'content-length': data.byteLength
  })
  response.end(data)
}

export function handleCapabilities(
  session: SecurityStateAccessSession,
  response: ServerResponse
): void {
  const now = Date.now()
  const payload = buildDesktopAuthBody(session.identity, session.identity.cloudProfileId, now)

  const data = Buffer.from(JSON.stringify(payload))
  response.writeHead(200, {
    'content-type': 'application/json',
    'content-length': data.byteLength
  })
  response.end(data)
}

export function handleProfile(session: SecurityStateAccessSession, response: ServerResponse): void {
  const payload = {
    userId: session.identity.userId,
    cloudProfileId: session.identity.cloudProfileId,
    activeOrgId: session.identity.organizationId || undefined,
    email: session.identity.email,
    displayName: undefined
  }

  const data = Buffer.from(JSON.stringify(payload))
  response.writeHead(200, {
    'content-type': 'application/json',
    'content-length': data.byteLength
  })
  response.end(data)
}

export async function handleLogoutPost(
  session: SecurityStateAccessSession,
  body: unknown,
  securityState: OwnMobileRelaySecurityState,
  _store: OwnMobileRelayAuthStore,
  response: ServerResponse
): Promise<void> {
  await securityState.revokeAccessSessionById(session.sessionId)
  await securityState.revokeRefreshTokensForSession(session.sessionId)

  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>
    if (typeof record.refreshToken === 'string') {
      const lookup = await securityState.lookupRefreshToken(record.refreshToken, Date.now())
      if (lookup) {
        await securityState.revokeAccessSessionById(lookup.sessionId)
        await securityState.revokeRefreshTokensForSession(lookup.sessionId)
      }
    }
  }

  const data = Buffer.from(JSON.stringify({ ok: true }))
  response.writeHead(200, {
    'content-type': 'application/json',
    'content-length': data.byteLength
  })
  response.end(data)
}
