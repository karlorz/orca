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
  store: OwnMobileRelayAuthStore,
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

  const ephemeral = store.refreshTokens.get(oldRefreshToken)
  if (!ephemeral) {
    response.writeHead(401, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: 'invalid_grant' }))
    return
  }

  const newAccessToken = randomBytes(32).toString('base64url')
  const newRefreshToken = randomBytes(32).toString('base64url')
  const now = Date.now()

  const issued = await securityState.replaceAccessSession({
    oldSessionId: ephemeral.sessionId,
    newRawAccessToken: newAccessToken,
    ttlMs: SESSION_TTL_MS
  })

  if (!issued) {
    store.refreshTokens.delete(oldRefreshToken)
    response.writeHead(401, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: 'invalid_grant' }))
    return
  }

  // Rotate ephemeral refresh state only after durable success
  store.refreshTokens.delete(oldRefreshToken)
  store.refreshTokens.set(newRefreshToken, {
    refreshToken: newRefreshToken,
    sessionId: issued.sessionId,
    cloudProfileId: ephemeral.cloudProfileId
  })

  const payload = {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    expiresAt: issued.expiresAt,
    ...buildDesktopAuthBody(issued.identity, ephemeral.cloudProfileId, now)
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
  store: OwnMobileRelayAuthStore,
  response: ServerResponse
): Promise<void> {
  await securityState.revokeAccessSessionById(session.sessionId)

  for (const [token, record] of store.refreshTokens.entries()) {
    if (record.sessionId === session.sessionId) {
      store.refreshTokens.delete(token)
    }
  }

  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>
    if (typeof record.refreshToken === 'string') {
      const extra = store.refreshTokens.get(record.refreshToken)
      if (extra) {
        await securityState.revokeAccessSessionById(extra.sessionId)
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
