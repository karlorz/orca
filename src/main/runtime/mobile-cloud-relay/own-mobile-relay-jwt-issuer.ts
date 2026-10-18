import { readFileSync, writeFileSync } from 'node:fs'
import {
  calculateJwkThumbprint,
  exportJWK,
  generateKeyPair,
  importJWK,
  SignJWT,
  type JWK
} from 'jose'

// Claim contract mirrors cloud/apps/relay/src/relay-token-verifier.ts.
export const RELAY_TOKEN_JWT_AUDIENCE = 'orca-relay'
export const RELAY_TOKEN_JWT_PURPOSE = 'host-control'

export type RelayTokenSigningKey = {
  readonly kid: string
  readonly privateJwk: JWK
  readonly publicJwk: JWK
}

export async function createRelayTokenSigningKey(): Promise<RelayTokenSigningKey> {
  const pair = await generateKeyPair('ES256', { extractable: true })
  const publicJwk = await exportJWK(pair.publicKey)
  const privateJwk = await exportJWK(pair.privateKey)
  const kid = await calculateJwkThumbprint(publicJwk, 'sha256')
  return {
    kid,
    privateJwk: { ...privateJwk, alg: 'ES256' },
    publicJwk: { ...publicJwk, kid, alg: 'ES256', use: 'sig' }
  }
}

function isStoredSigningKey(value: unknown): value is { privateJwk: JWK; publicJwk: JWK } {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const record = value as { privateJwk?: JWK; publicJwk?: JWK }
  for (const jwk of [record.privateJwk, record.publicJwk]) {
    if (
      !jwk ||
      jwk.kty !== 'EC' ||
      jwk.crv !== 'P-256' ||
      typeof jwk.x !== 'string' ||
      typeof jwk.y !== 'string'
    ) {
      return false
    }
  }
  return typeof record.privateJwk?.d === 'string'
}

// The key is the root of every minted relay token: fail closed on a corrupt
// file so rotation stays an attended operation instead of a silent re-key.
export async function loadOrCreateRelayTokenSigningKey(
  filePath: string
): Promise<RelayTokenSigningKey> {
  let stored: unknown
  try {
    stored = JSON.parse(readFileSync(filePath, 'utf8')) as unknown
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
    const key = await createRelayTokenSigningKey()
    writeFileSync(filePath, `${JSON.stringify(key, null, 2)}\n`, { mode: 0o600 })
    return key
  }
  if (!isStoredSigningKey(stored)) {
    throw new Error(`invalid relay token signing key at ${filePath}`)
  }
  // kid derives from the public material so a hand-edited kid cannot split
  // the header from the JWKS entry verifiers match on.
  const kid = await calculateJwkThumbprint(stored.publicJwk, 'sha256')
  return {
    kid,
    privateJwk: { ...stored.privateJwk, alg: 'ES256' },
    publicJwk: { ...stored.publicJwk, kid, alg: 'ES256', use: 'sig' }
  }
}

export async function mintRelayTokenJwt(input: {
  key: RelayTokenSigningKey
  issuer: string
  subject: string
  cloudProfileId: string
  organizationId?: string
  relayHostId: string
  expiresAtMs: number
}): Promise<string> {
  const privateKey = await importJWK(input.key.privateJwk, 'ES256')
  const claims: Record<string, unknown> = {
    prof: input.cloudProfileId,
    purpose: RELAY_TOKEN_JWT_PURPOSE,
    relayHostId: input.relayHostId
  }
  // The official claims schema rejects an empty org string, so omit it.
  if (input.organizationId) {
    claims.org = input.organizationId
  }
  return await new SignJWT(claims)
    .setProtectedHeader({ alg: 'ES256', kid: input.key.kid })
    .setIssuer(input.issuer)
    .setAudience(RELAY_TOKEN_JWT_AUDIENCE)
    .setSubject(input.subject)
    .setIssuedAt()
    .setExpirationTime(Math.floor(input.expiresAtMs / 1000))
    .sign(privateKey)
}

// Public fields only: the JWKS document is served unauthenticated and must
// never carry the private component.
export function relayTokenJwks(key: RelayTokenSigningKey): { keys: JWK[] } {
  const { kty, crv, x, y } = key.publicJwk
  return { keys: [{ kty, crv, x, y, kid: key.kid, alg: 'ES256', use: 'sig' }] }
}
