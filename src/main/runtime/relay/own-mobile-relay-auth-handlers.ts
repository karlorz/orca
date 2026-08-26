import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  type AuthorizationCodeRecord,
  type OwnMobileRelayAuthStore,
  isLoopbackCallbackUri,
  verifyS256CodeChallenge
} from './own-mobile-relay-auth-store'
import type { OwnMobileRelaySecurityState } from './own-mobile-relay-security-state'
import {
  verifyPasswordRecord,
  derivePasswordRecord,
  CURRENT_PASSWORD_POLICY,
  type PasswordPolicy
} from './own-mobile-relay-password'

const AUTH_CODE_TTL_MS = 5 * 60 * 1000
const SESSION_TTL_MS = 60 * 60 * 1000

export function validateAuthorizeParams(
  url: URL,
  configuredClientId: string
): {
  valid: boolean
  clientId: string
  redirectUri: string
  codeChallenge: string
  codeChallengeMethod: string
  state?: string
  nonce?: string
  localProfileId?: string
} {
  const clientId = url.searchParams.get('client_id') ?? ''
  const redirectUri = url.searchParams.get('redirect_uri') ?? ''
  const codeChallenge = url.searchParams.get('code_challenge') ?? ''
  const codeChallengeMethod = url.searchParams.get('code_challenge_method') ?? ''
  const state = url.searchParams.get('state') ?? undefined
  const nonce = url.searchParams.get('nonce') ?? undefined
  const localProfileId = url.searchParams.get('local_profile_id') ?? undefined

  if (
    clientId !== configuredClientId ||
    !isLoopbackCallbackUri(redirectUri) ||
    codeChallengeMethod !== 'S256' ||
    !codeChallenge
  ) {
    return {
      valid: false,
      clientId,
      redirectUri,
      codeChallenge,
      codeChallengeMethod,
      state,
      nonce,
      localProfileId
    }
  }

  return {
    valid: true,
    clientId,
    redirectUri,
    codeChallenge,
    codeChallengeMethod,
    state,
    nonce,
    localProfileId
  }
}

export function renderLoginForm(actionUrl: string): string {
  return `<!DOCTYPE html>
<html>
<head><title>Sign in for Relay</title></head>
<body>
  <form method="POST" action="${actionUrl}">
    <label>Email: <input type="email" name="email" required /></label>
    <label>Password: <input type="password" name="password" required /></label>
    <button type="submit">Sign In</button>
  </form>
</body>
</html>`
}

export async function readUrlEncodedBody(request: IncomingMessage): Promise<URLSearchParams> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk) => chunks.push(chunk as Buffer))
    request.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve(new URLSearchParams(text))
      } catch (err) {
        reject(err)
      }
    })
    request.on('error', reject)
  })
}

export function handleAuthorizeGet(
  url: URL,
  configuredClientId: string,
  response: ServerResponse
): void {
  const validation = validateAuthorizeParams(url, configuredClientId)
  if (!validation.valid) {
    response.writeHead(400, { 'content-type': 'text/plain' })
    response.end('Invalid authorize request')
    return
  }

  const html = renderLoginForm(url.pathname + url.search)
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(html)
  })
  response.end(html)
}

export async function handleAuthorizePost(
  request: IncomingMessage,
  url: URL,
  securityState: OwnMobileRelaySecurityState,
  configuredClientId: string,
  store: OwnMobileRelayAuthStore,
  response: ServerResponse,
  passwordPolicy: PasswordPolicy = CURRENT_PASSWORD_POLICY
): Promise<void> {
  const validation = validateAuthorizeParams(url, configuredClientId)
  if (!validation.valid) {
    response.writeHead(400, { 'content-type': 'text/plain' })
    response.end('Invalid authorize request')
    return
  }

  let body: URLSearchParams
  try {
    body = await readUrlEncodedBody(request)
  } catch {
    response.writeHead(400, { 'content-type': 'text/plain' })
    response.end('Invalid form body')
    return
  }

  const email = body.get('email') ?? ''
  const password = body.get('password') ?? ''

  const account = await securityState.getAccount()
  const passwordRec = await securityState.getAccountPasswordRecord()

  if (!account || !passwordRec || email !== account.email) {
    response.writeHead(401, { 'content-type': 'text/plain' })
    response.end('Unauthorized')
    return
  }

  const verifyResult = await verifyPasswordRecord(
    password,
    passwordRec.passwordRecord,
    passwordPolicy
  )
  if (!verifyResult.valid) {
    response.writeHead(401, { 'content-type': 'text/plain' })
    response.end('Unauthorized')
    return
  }

  if (verifyResult.needsRehash) {
    try {
      const newRecord = await derivePasswordRecord(password, passwordPolicy)
      await securityState.upgradePasswordVerifier({
        expectedVerifierVersion: passwordRec.verifierVersion,
        newPasswordRecord: newRecord
      })
    } catch {
      // Non-fatal if upgrade fails; login still succeeds
    }
  }

  const code = randomBytes(32).toString('base64url')
  const record: AuthorizationCodeRecord = {
    code,
    codeChallenge: validation.codeChallenge,
    redirectUri: validation.redirectUri,
    clientId: validation.clientId,
    state: validation.state,
    nonce: validation.nonce,
    localProfileId: validation.localProfileId,
    identity: {
      userId: account.userId,
      profileId: account.profileId,
      organizationId: account.organizationId,
      email: account.email
    },
    expiresAt: Date.now() + AUTH_CODE_TTL_MS,
    used: false
  }

  store.codes.set(code, record)

  const redirectUrl = new URL(validation.redirectUri)
  redirectUrl.searchParams.set('code', code)
  if (validation.state) {
    redirectUrl.searchParams.set('state', validation.state)
  }

  response.writeHead(302, {
    location: redirectUrl.toString()
  })
  response.end()
}

export async function handleSessionPost(
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
  const code = typeof record.code === 'string' ? record.code : ''
  const codeVerifier = typeof record.codeVerifier === 'string' ? record.codeVerifier : ''

  if (!code || !codeVerifier) {
    response.writeHead(400, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: 'invalid_request' }))
    return
  }

  const authCode = store.codes.get(code)
  if (!authCode) {
    response.writeHead(400, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: 'invalid_grant' }))
    return
  }

  if (authCode.used || authCode.expiresAt <= Date.now()) {
    store.codes.delete(code)
    response.writeHead(400, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: 'invalid_grant' }))
    return
  }

  // Mark code used immediately (single-use)
  authCode.used = true
  store.codes.delete(code)

  if (!verifyS256CodeChallenge(codeVerifier, authCode.codeChallenge)) {
    response.writeHead(401, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: 'unauthorized_client' }))
    return
  }

  const rawAccessToken = randomBytes(32).toString('base64url')
  const refreshToken = randomBytes(32).toString('base64url')
  const now = Date.now()

  const cloudProfileId = authCode.localProfileId || authCode.identity.profileId

  const issuedSession = await securityState.issueAccessSession({
    rawAccessToken,
    identity: {
      userId: authCode.identity.userId,
      profileId: authCode.identity.profileId,
      organizationId: authCode.identity.organizationId,
      email: authCode.identity.email,
      cloudProfileId
    },
    ttlMs: SESSION_TTL_MS
  })

  store.refreshTokens.set(refreshToken, {
    refreshToken,
    sessionId: issuedSession.sessionId,
    cloudProfileId
  })

  const payload = {
    accessToken: rawAccessToken,
    refreshToken,
    expiresAt: issuedSession.expiresAt,
    cloud: {
      cloudProfileId,
      userId: authCode.identity.userId,
      email: authCode.identity.email,
      displayName: undefined,
      activeOrgId: authCode.identity.organizationId || undefined,
      activeOrgName: undefined,
      linkedAt: now
    },
    organizations: authCode.identity.organizationId
      ? [
          {
            orgId: authCode.identity.organizationId,
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
