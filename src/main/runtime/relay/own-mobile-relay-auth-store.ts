import { timingSafeEqual, createHash } from 'node:crypto'

export type AuthorizationCodeRecord = {
  code: string
  codeChallenge: string
  redirectUri: string
  clientId: string
  state?: string
  nonce?: string
  localProfileId?: string
  identity: {
    userId: string
    profileId: string
    organizationId: string
    email: string
  }
  expiresAt: number
  used: boolean
}

export type EphemeralRefreshTokenRecord = {
  refreshToken: string
  sessionId: string
  cloudProfileId: string
}

export type OwnMobileRelayAuthStore = {
  codes: Map<string, AuthorizationCodeRecord>
  refreshTokens: Map<string, EphemeralRefreshTokenRecord>
}

export function createOwnMobileRelayAuthStore(): OwnMobileRelayAuthStore {
  return {
    codes: new Map(),
    refreshTokens: new Map()
  }
}

export function isLoopbackCallbackUri(uri: string): boolean {
  try {
    const parsed = new URL(uri)
    const host = parsed.hostname
    const isLoopback = host === '127.0.0.1' || host === 'localhost' || host === '[::1]'
    return isLoopback && parsed.pathname === '/auth/callback'
  } catch {
    return false
  }
}

export function verifyS256CodeChallenge(codeVerifier: string, expectedChallenge: string): boolean {
  const hash = createHash('sha256').update(codeVerifier).digest('base64url')
  const bufA = Buffer.from(hash, 'utf8')
  const bufB = Buffer.from(expectedChallenge, 'utf8')
  if (bufA.byteLength !== bufB.byteLength) {
    return false
  }
  return timingSafeEqual(bufA, bufB)
}
