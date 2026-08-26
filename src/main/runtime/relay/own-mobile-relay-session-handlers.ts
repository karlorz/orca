import { randomBytes } from 'node:crypto'
import type { ServerResponse } from 'node:http'
import type { AuthSessionRecord, OwnMobileRelayAuthStore } from './own-mobile-relay-auth-store'

const SESSION_TTL_MS = 60 * 60 * 1000

export function handleRefreshPost(
  body: unknown,
  store: OwnMobileRelayAuthStore,
  response: ServerResponse
): void {
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

  const existingSession = store.refreshTokens.get(oldRefreshToken)
  if (!existingSession) {
    response.writeHead(401, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: 'invalid_grant' }))
    return
  }

  store.refreshTokens.delete(oldRefreshToken)
  store.sessions.delete(existingSession.accessToken)

  const newAccessToken = randomBytes(32).toString('base64url')
  const newRefreshToken = randomBytes(32).toString('base64url')
  const now = Date.now()
  const expiresAt = now + SESSION_TTL_MS

  const newSessionRecord: AuthSessionRecord = {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    expiresAt,
    identity: existingSession.identity
  }

  store.sessions.set(newAccessToken, newSessionRecord)
  store.refreshTokens.set(newRefreshToken, newSessionRecord)

  const payload = {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    expiresAt,
    cloud: {
      cloudProfileId: existingSession.identity.cloudProfileId,
      userId: existingSession.identity.userId,
      email: existingSession.identity.email,
      displayName: undefined,
      activeOrgId: existingSession.identity.organizationId || undefined,
      activeOrgName: undefined,
      linkedAt: now
    },
    organizations: existingSession.identity.organizationId
      ? [
          {
            orgId: existingSession.identity.organizationId,
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

  const data = Buffer.from(JSON.stringify(payload))
  response.writeHead(200, {
    'content-type': 'application/json',
    'content-length': data.byteLength
  })
  response.end(data)
}

export function handleCapabilities(session: AuthSessionRecord, response: ServerResponse): void {
  const now = Date.now()
  const payload = {
    cloud: {
      cloudProfileId: session.identity.cloudProfileId,
      userId: session.identity.userId,
      email: session.identity.email,
      displayName: undefined,
      activeOrgId: session.identity.organizationId || undefined,
      activeOrgName: undefined,
      linkedAt: now
    },
    organizations: session.identity.organizationId
      ? [
          {
            orgId: session.identity.organizationId,
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

  const data = Buffer.from(JSON.stringify(payload))
  response.writeHead(200, {
    'content-type': 'application/json',
    'content-length': data.byteLength
  })
  response.end(data)
}

export function handleProfile(session: AuthSessionRecord, response: ServerResponse): void {
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

export function handleLogoutPost(
  session: AuthSessionRecord,
  body: unknown,
  store: OwnMobileRelayAuthStore,
  response: ServerResponse
): void {
  store.sessions.delete(session.accessToken)
  store.refreshTokens.delete(session.refreshToken)

  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>
    if (typeof record.refreshToken === 'string') {
      const extraSession = store.refreshTokens.get(record.refreshToken)
      if (extraSession) {
        store.sessions.delete(extraSession.accessToken)
        store.refreshTokens.delete(record.refreshToken)
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
