import { describe, expect, it } from 'vitest'
import { loadConfig } from './config.js'
import { buildSnapshot } from './snapshot.js'

describe('buildSnapshot', () => {
  const sampleAuthCoolify = {
    uuid: 'bfxz2ef22nep35ytcv6qqj0t',
    name: 'orca-auth-prod',
    status: 'running',
    docker_image: 'ghcr.io/karlorz/orca-auth:v1.0.0@sha256:abc123'
  }

  const sampleRelayCoolify = {
    uuid: 'kl8ypbofi72soo46ha1cr85i',
    name: 'orca-relay-prod',
    status: 'running',
    docker_image: 'ghcr.io/karlorz/orca-relay:v1.4.0@sha256:def456'
  }

  const sampleJwks = {
    keys: [{ kty: 'RSA', kid: 'auth-key-2026', use: 'sig' }]
  }

  it('builds healthy snapshot and maps Coolify status+image from fixture without hardcoding image', async () => {
    const config = loadConfig({
      COOLIFY_API_TOKEN: 'super-secret-token'
    })

    const mockFetch = async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/v1/applications/bfxz2ef22nep35ytcv6qqj0t')) {
        return new Response(JSON.stringify(sampleAuthCoolify), { status: 200 })
      }
      if (url.includes('/api/v1/applications/kl8ypbofi72soo46ha1cr85i')) {
        return new Response(JSON.stringify(sampleRelayCoolify), { status: 200 })
      }
      if (url.includes('/.well-known/jwks.json')) {
        return new Response(JSON.stringify(sampleJwks), { status: 200 })
      }
      if (url.endsWith('/health') || url.endsWith('/ready')) {
        return new Response('OK', { status: 200 })
      }
      return new Response('Not Found', { status: 404 })
    }

    const snapshot = await buildSnapshot(config, mockFetch)

    expect(snapshot.rows).toHaveLength(2)
    const [authRow, relayRow] = snapshot.rows

    // Exactly two rows
    expect(authRow.id).toBe('own-auth')
    expect(relayRow.id).toBe('official-relay')

    // Coolify status and dynamic image mapped from fixture
    expect(authRow.coolify.status).toBe(sampleAuthCoolify.status)
    expect(authRow.coolify.image).toBe(sampleAuthCoolify.docker_image)
    expect(relayRow.coolify.status).toBe(sampleRelayCoolify.status)
    expect(relayRow.coolify.image).toBe(sampleRelayCoolify.docker_image)

    // Probes
    expect(authRow.probes.health.status).toBe('ok')
    expect(authRow.probes.jwks.status).toBe('ok')
    expect(authRow.probes.jwks.keyCount).toBe(sampleJwks.keys.length)
    expect(authRow.probes.jwks.kids).toEqual(['auth-key-2026'])

    expect(relayRow.probes.health.status).toBe('ok')
    expect(relayRow.probes.ready.status).toBe('ok')

    const serialized = JSON.stringify(snapshot)
    expect(serialized).not.toContain('super-secret-token')
    expect(serialized).not.toContain('"kty"')
  })

  it('keeps probes successful even when Coolify returns 401/404', async () => {
    const config = loadConfig({})

    const mockFetch = async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/v1/applications/')) {
        return new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' })
      }
      if (url.includes('/.well-known/jwks.json')) {
        return new Response(JSON.stringify(sampleJwks), { status: 200 })
      }
      if (url.endsWith('/health') || url.endsWith('/ready')) {
        return new Response('OK', { status: 200 })
      }
      return new Response('Not Found', { status: 404 })
    }

    const snapshot = await buildSnapshot(config, mockFetch)
    const [authRow, relayRow] = snapshot.rows

    expect(authRow.coolify.status).toBe('error')
    expect(authRow.coolify.error).toContain('HTTP 401: Unauthorized')
    expect(authRow.probes.health.status).toBe('ok')
    expect(authRow.probes.jwks.status).toBe('ok')

    expect(relayRow.coolify.status).toBe('error')
    expect(relayRow.probes.health.status).toBe('ok')
    expect(relayRow.probes.ready.status).toBe('ok')
  })

  it('does not include any unknown extra Coolify apps', async () => {
    const config = loadConfig({})

    const mockFetch = async () =>
      new Response(JSON.stringify({ status: 'running' }), { status: 200 })
    const snapshot = await buildSnapshot(config, mockFetch)

    expect(snapshot.rows.length).toBe(2)
    const rowIds = snapshot.rows.map((r) => r.id)
    expect(rowIds).toEqual(['own-auth', 'official-relay'])
  })
})
