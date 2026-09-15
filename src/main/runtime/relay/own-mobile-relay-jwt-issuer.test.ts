import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decodeJwt, generateKeyPair, importJWK, SignJWT } from 'jose'
import nacl from 'tweetnacl'
import { describe, expect, it } from 'vitest'
// Cross-workspace seam on purpose: the own-auth issuer must mint tokens the
// shipped official verifier accepts, so this test pins that file directly.
// Excluded from config/tsconfig.node.json because the cloud package's
// transitive type graph (zod v3, @orca-cloud/relay-contract dist) is not part
// of the root typecheck; vitest transforms it dependency-light at runtime.
import { createRelayTokenVerifier } from '../../../../cloud/apps/relay/src/relay-token-verifier'
import type { RelayConfig } from '../../../../cloud/apps/relay/src/config'
import { deriveRelayHostId } from './relay-http-client'
import { listenOwnMobileRelay } from './own-mobile-relay-http'
import {
  createRelayTokenSigningKey,
  loadOrCreateRelayTokenSigningKey,
  type RelayTokenSigningKey
} from './own-mobile-relay-jwt-issuer'
import { loginAndObtainSessionToken, TEST_OPERATOR } from './own-mobile-relay-test-auth'
import { startOwnRelayServer } from './own-mobile-relay-main'
import { TEST_FAST_PASSWORD_POLICY } from './own-mobile-relay-password'

const AUTH_ORIGIN = 'http://127.0.0.1'

function relayVerifierConfig(input: { jwksUrl: string; authIssuer: string }): RelayConfig {
  return {
    port: 0,
    publicUrl: 'https://relay.example.test',
    cellUrl: 'https://relay.example.test',
    authIssuer: input.authIssuer,
    authAudience: 'orca-relay',
    jwksUrl: input.jwksUrl,
    assignmentSigningKey: new TextEncoder().encode('assignment-key-with-at-least-32-bytes'),
    role: 'combined',
    cellId: 'combined',
    cells: [],
    adminAudience: 'https://admin.example.test',
    deployServiceAccount: 'deploy@example.test',
    runtimeServiceAccount: 'deploy@example.test',
    adminJwksUrl: 'https://admin.example.test/jwks',
    databasePoolMax: 10,
    publicAssignmentsEnabled: true,
    publicAssignmentConcurrency: 2,
    publicAssignmentQueueMax: 128,
    publicAssignmentWaitMs: 4_000,
    publicResolveConcurrency: 1,
    publicResolveWaitMs: 5_000,
    publicAssignmentRetryAfterSeconds: 5,
    dataDir: './data/relay'
  }
}

async function startJwtRelay(operator = TEST_OPERATOR): Promise<{
  key: RelayTokenSigningKey
  server: Awaited<ReturnType<typeof listenOwnMobileRelay>>
}> {
  const key = await createRelayTokenSigningKey()
  const server = await listenOwnMobileRelay({
    operator,
    origin: 'http://127.0.0.1',
    authOrigin: AUTH_ORIGIN,
    relayTokenSigningKey: key
  })
  return { key, server }
}

async function mintRelayTokenOverHttp(
  server: Awaited<ReturnType<typeof listenOwnMobileRelay>>,
  operator = TEST_OPERATOR
): Promise<{ relayToken: string; expiresAt: number; relayHostId: string }> {
  const hostPublicKey = nacl.box.keyPair().publicKey
  const relayHostId = deriveRelayHostId(hostPublicKey)
  const sessionToken = await loginAndObtainSessionToken(server.origin, operator)
  const response = await fetch(`${server.origin}/v1/desktop/auth/relay-token`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${sessionToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      relayHostId,
      hostPublicKeyB64: Buffer.from(hostPublicKey).toString('base64')
    })
  })
  expect(response.status).toBe(200)
  const body = (await response.json()) as { relayToken: string; expiresAt: number }
  return { ...body, relayHostId }
}

async function signWithServerKey(
  key: RelayTokenSigningKey,
  claims: Record<string, unknown>,
  options: { issuer?: string; audience?: string; expirationTime?: number } = {}
): Promise<string> {
  const privateKey = await importJWK(key.privateJwk, 'ES256')
  return await new SignJWT(claims)
    .setProtectedHeader({ alg: 'ES256', kid: key.kid })
    .setIssuer(options.issuer ?? AUTH_ORIGIN)
    .setAudience(options.audience ?? 'orca-relay')
    .setSubject('user-test-op-1')
    .setIssuedAt()
    .setExpirationTime(options.expirationTime ?? Math.floor(Date.now() / 1000) + 300)
    .sign(privateKey)
}

describe('own-auth relay token JWT (official relay interop)', () => {
  it('mints an ES256 JWT the shipped official verifier accepts against the live JWKS', async () => {
    const { key, server } = await startJwtRelay()
    try {
      const jwksResponse = await fetch(`${server.origin}/.well-known/jwks.json`)
      expect(jwksResponse.status).toBe(200)
      const jwks = (await jwksResponse.json()) as { keys: Record<string, unknown>[] }
      expect(jwks.keys).toHaveLength(1)
      expect(jwks.keys[0]).toMatchObject({
        kty: 'EC',
        crv: 'P-256',
        kid: key.kid,
        alg: 'ES256',
        use: 'sig'
      })
      expect(jwks.keys[0]).not.toHaveProperty('d')

      const { relayToken, expiresAt, relayHostId } = await mintRelayTokenOverHttp(server)
      expect(expiresAt).toBeGreaterThan(Date.now())

      const verify = createRelayTokenVerifier(
        relayVerifierConfig({
          jwksUrl: `${server.origin}/.well-known/jwks.json`,
          authIssuer: AUTH_ORIGIN
        })
      )
      const claims = await verify(relayToken)
      expect(claims).toMatchObject({
        sub: TEST_OPERATOR.userId,
        prof: TEST_OPERATOR.profileId,
        org: TEST_OPERATOR.organizationId,
        relayHostId,
        purpose: 'host-control'
      })
      expect(claims?.exp).toBeGreaterThan(Math.floor(Date.now() / 1000))
    } finally {
      await server.close()
    }
  })

  it('keeps the legacy own-relay assign path working on the JWT string', async () => {
    const { server } = await startJwtRelay()
    try {
      const { relayToken, relayHostId } = await mintRelayTokenOverHttp(server)
      const assignResponse = await fetch(`${server.origin}/v1/assign`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${relayToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ v: 1, relayHostId })
      })
      expect(assignResponse.status).toBe(200)
      await expect(assignResponse.json()).resolves.toMatchObject({
        v: 1,
        cellUrl: server.origin
      })
    } finally {
      await server.close()
    }
  })

  it('omits the org claim for an org-less account and still verifies', async () => {
    const orglessOperator = { ...TEST_OPERATOR, organizationId: '' }
    const { server } = await startJwtRelay(orglessOperator)
    try {
      const { relayToken, relayHostId } = await mintRelayTokenOverHttp(server, orglessOperator)
      const payload = decodeJwt(relayToken)
      expect(payload).not.toHaveProperty('org')
      const verify = createRelayTokenVerifier(
        relayVerifierConfig({
          jwksUrl: `${server.origin}/.well-known/jwks.json`,
          authIssuer: AUTH_ORIGIN
        })
      )
      await expect(verify(relayToken)).resolves.toMatchObject({
        sub: orglessOperator.userId,
        prof: orglessOperator.profileId,
        relayHostId,
        purpose: 'host-control'
      })
    } finally {
      await server.close()
    }
  })

  it.each([
    { name: 'empty prof', claims: { prof: '' } },
    { name: 'wrong-shape relayHostId', claims: { relayHostId: 'short' } },
    { name: 'wrong purpose', claims: { purpose: 'client-connect' } },
    { name: 'empty org string', claims: { org: '' } }
  ])('rejects a token with $name', async ({ claims: wrongClaims }) => {
    const { key, server } = await startJwtRelay()
    try {
      const { relayHostId } = await mintRelayTokenOverHttp(server)
      const verify = createRelayTokenVerifier(
        relayVerifierConfig({
          jwksUrl: `${server.origin}/.well-known/jwks.json`,
          authIssuer: AUTH_ORIGIN
        })
      )
      const token = await signWithServerKey(key, {
        prof: TEST_OPERATOR.profileId,
        purpose: 'host-control',
        relayHostId,
        ...wrongClaims
      })
      await expect(verify(token)).resolves.toBeNull()
    } finally {
      await server.close()
    }
  })

  it('rejects wrong issuer, audience, algorithm, key, and expired tokens', async () => {
    const { key, server } = await startJwtRelay()
    try {
      const { relayHostId } = await mintRelayTokenOverHttp(server)
      const verify = createRelayTokenVerifier(
        relayVerifierConfig({
          jwksUrl: `${server.origin}/.well-known/jwks.json`,
          authIssuer: AUTH_ORIGIN
        })
      )
      const baseClaims = {
        prof: TEST_OPERATOR.profileId,
        purpose: 'host-control',
        relayHostId
      }
      await expect(
        verify(await signWithServerKey(key, baseClaims, { issuer: 'https://evil.example.test' }))
      ).resolves.toBeNull()
      await expect(
        verify(await signWithServerKey(key, baseClaims, { audience: 'orca-cloud' }))
      ).resolves.toBeNull()
      await expect(
        verify(
          await signWithServerKey(key, baseClaims, {
            expirationTime: Math.floor(Date.now() / 1000) - 60
          })
        )
      ).resolves.toBeNull()

      // Same kid as the served key but RS256: pinned to the algorithm allowlist.
      const rsa = await generateKeyPair('RS256', { extractable: true })
      const rsaToken = await new SignJWT(baseClaims)
        .setProtectedHeader({ alg: 'RS256', kid: key.kid })
        .setIssuer(AUTH_ORIGIN)
        .setAudience('orca-relay')
        .setSubject('user-test-op-1')
        .setExpirationTime(Math.floor(Date.now() / 1000) + 300)
        .sign(rsa.privateKey)
      await expect(verify(rsaToken)).resolves.toBeNull()

      const otherEc = await createRelayTokenSigningKey()
      await expect(verify(await signWithServerKey(otherEc, baseClaims))).resolves.toBeNull()
    } finally {
      await server.close()
    }
  })

  it('persists the signing key with owner-only permissions and fails closed on corruption', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'own-relay-jwt-key-'))
    try {
      const keyPath = join(dir, 'own-relay-jwt-signing-key.json')
      const first = await loadOrCreateRelayTokenSigningKey(keyPath)
      const second = await loadOrCreateRelayTokenSigningKey(keyPath)
      expect(second.kid).toBe(first.kid)
      expect(second.privateJwk.d).toBe(first.privateJwk.d)
      expect(statSync(keyPath).mode & 0o777).toBe(0o600)

      writeFileSync(keyPath, '{"broken":true}\n', { mode: 0o600 })
      await expect(loadOrCreateRelayTokenSigningKey(keyPath)).rejects.toThrow(
        'invalid relay token signing key'
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reuses the durable key across real server restarts so issued tokens keep verifying', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'own-relay-jwt-restart-'))
    const statePath = join(dir, 'security-state.db')
    const config = {
      statePath,
      origin: 'http://127.0.0.1',
      authOrigin: AUTH_ORIGIN,
      clientId: 'orca-desktop',
      listenHost: '127.0.0.1',
      listenPort: 0,
      operator: {
        email: TEST_OPERATOR.email,
        password: TEST_OPERATOR.password,
        userId: TEST_OPERATOR.userId,
        profileId: TEST_OPERATOR.profileId,
        organizationId: TEST_OPERATOR.organizationId
      }
    }
    const first = await startOwnRelayServer({
      config,
      passwordPolicy: TEST_FAST_PASSWORD_POLICY
    })
    let firstKid: string
    try {
      const jwks = (await (await fetch(`${first.origin}/.well-known/jwks.json`)).json()) as {
        keys: { kid?: string }[]
      }
      firstKid = jwks.keys[0]?.kid ?? ''
      expect(firstKid).not.toBe('')
    } finally {
      await first.close()
    }

    // Second boot: account already exists, so no bootstrap env group.
    const second = await startOwnRelayServer({
      config: { ...config, operator: undefined },
      passwordPolicy: TEST_FAST_PASSWORD_POLICY
    })
    try {
      const jwks = (await (await fetch(`${second.origin}/.well-known/jwks.json`)).json()) as {
        keys: { kid?: string }[]
      }
      expect(jwks.keys[0]?.kid).toBe(firstKid)
    } finally {
      await second.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
