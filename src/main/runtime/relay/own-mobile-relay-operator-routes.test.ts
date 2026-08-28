import { describe, expect, it } from 'vitest'
import http from 'node:http'
import { listenOwnMobileRelay } from './own-mobile-relay-http'
import { TEST_OPERATOR } from './own-mobile-relay-test-auth'
import { createOwnMobileRelayAuditMemory } from './own-mobile-relay-audit-memory'

function httpRequest(options: {
  port: number
  path: string
  method?: string
  headers?: Record<string, string>
  body?: string
}): Promise<{
  status: number
  headers: http.IncomingHttpHeaders
  json: () => Promise<unknown>
  text: () => Promise<string>
}> {
  return new Promise((resolve, reject) => {
    const headers = { ...options.headers }
    if (options.body && !headers['content-length']) {
      headers['content-length'] = String(Buffer.byteLength(options.body))
    }
    const req = http.request(
      {
        host: '127.0.0.1',
        port: options.port,
        path: options.path,
        method: options.method ?? 'GET',
        headers
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c as Buffer))
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8')
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            text: async () => raw,
            json: async () => JSON.parse(raw)
          })
        })
      }
    )
    req.on('error', reject)
    if (options.body) {
      req.write(options.body)
    }
    req.end()
  })
}

describe('OwnMobileRelay Operator Routes Slice 3 (/v1/operator/*)', () => {
  // Test 1: login 200 issues token; wrong password 401
  it('1. login 200 issues token; wrong password 401; never echoes password', async () => {
    const server = await listenOwnMobileRelay({
      operator: TEST_OPERATOR,
      origin: 'http://127.0.0.1'
    })
    try {
      // Wrong password
      const badRes = await fetch(`${server.origin}/v1/operator/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: TEST_OPERATOR.email,
          password: 'wrong-password-999'
        })
      })
      expect(badRes.status).toBe(401)
      const badBody = await badRes.json()
      expect(badBody).toEqual({ error: 'unauthorized' })
      expect(JSON.stringify(badBody)).not.toContain('wrong-password-999')

      // Wrong email
      const badEmailRes = await fetch(`${server.origin}/v1/operator/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'wrong@example.com',
          password: TEST_OPERATOR.password
        })
      })
      expect(badEmailRes.status).toBe(401)

      // Valid credentials
      const loginRes = await fetch(`${server.origin}/v1/operator/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: TEST_OPERATOR.email,
          password: TEST_OPERATOR.password
        })
      })
      expect(loginRes.status).toBe(200)
      const loginBody = (await loginRes.json()) as { token: string; expiresAt: number }
      expect(typeof loginBody.token).toBe('string')
      expect(loginBody.token.length).toBeGreaterThan(16)
      expect(typeof loginBody.expiresAt).toBe('number')
      expect(loginBody.expiresAt).toBeGreaterThan(Date.now())
      expect(JSON.stringify(loginBody)).not.toContain(TEST_OPERATOR.password)
    } finally {
      await server.close()
    }
  })

  // Test 2: overview 401 without bearer; 200 with token
  it('2. overview 401 without bearer; 200 with token; logout revokes session', async () => {
    const server = await listenOwnMobileRelay({
      operator: TEST_OPERATOR,
      origin: 'http://127.0.0.1'
    })
    try {
      // 401 without bearer
      const noAuthRes = await fetch(`${server.origin}/v1/operator/overview`)
      expect(noAuthRes.status).toBe(401)
      expect(await noAuthRes.json()).toEqual({ error: 'unauthorized' })

      // 401 with bad bearer
      const badAuthRes = await fetch(`${server.origin}/v1/operator/overview`, {
        headers: { authorization: 'Bearer bad-invalid-token' }
      })
      expect(badAuthRes.status).toBe(401)

      // Login
      const loginRes = await fetch(`${server.origin}/v1/operator/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: TEST_OPERATOR.email,
          password: TEST_OPERATOR.password
        })
      })
      const { token } = (await loginRes.json()) as { token: string }

      // 200 with valid token
      const overviewRes = await fetch(`${server.origin}/v1/operator/overview`, {
        headers: { authorization: `Bearer ${token}` }
      })
      expect(overviewRes.status).toBe(200)
      const overview = (await overviewRes.json()) as {
        ok: boolean
        hostControlLive: boolean
        counts: { sessions: number; grants: number; devices: number; events: number }
      }
      expect(overview.ok).toBe(true)
      expect(typeof overview.hostControlLive).toBe('boolean')
      expect(overview.counts).toEqual({
        sessions: expect.any(Number),
        grants: expect.any(Number),
        devices: expect.any(Number),
        events: expect.any(Number)
      })

      // Logout
      const logoutRes = await fetch(`${server.origin}/v1/operator/logout`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` }
      })
      expect(logoutRes.status).toBe(200)
      expect(await logoutRes.json()).toEqual({ ok: true })

      // Overview is now 401
      const afterLogout = await fetch(`${server.origin}/v1/operator/overview`, {
        headers: { authorization: `Bearer ${token}` }
      })
      expect(afterLogout.status).toBe(401)
    } finally {
      await server.close()
    }
  })

  // Test 3: Host cell origin → 404 for /v1/operator/overview when authOrigin is different
  it('3. Host cell origin → 404 for /v1/operator/* when authOrigin is distinct', async () => {
    // Listen on loopback, but authOrigin is set to a specific domain (e.g. auth.example.com)
    // and cell/relay origin is cell.example.com
    const server = await listenOwnMobileRelay({
      operator: TEST_OPERATOR,
      origin: 'https://cell.example.com',
      authOrigin: 'https://auth.example.com',
      listenHost: '127.0.0.1'
    })
    try {
      // Direct request with Host: cell.example.com should be 404
      const cellReq = await httpRequest({
        port: server.boundPort,
        path: '/v1/operator/overview',
        headers: {
          Host: 'cell.example.com',
          authorization: 'Bearer any-token'
        }
      })
      expect(cellReq.status).toBe(404)
      expect(await cellReq.json()).toEqual({ error: 'not_found' })

      const cellLoginReq = await httpRequest({
        port: server.boundPort,
        path: '/v1/operator/login',
        method: 'POST',
        headers: {
          Host: 'cell.example.com',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          email: TEST_OPERATOR.email,
          password: TEST_OPERATOR.password
        })
      })
      expect(cellLoginReq.status).toBe(404)
      expect(await cellLoginReq.json()).toEqual({ error: 'not_found' })

      // Request with Host: auth.example.com allowed (login succeeds)
      const authLoginReq = await httpRequest({
        port: server.boundPort,
        path: '/v1/operator/login',
        method: 'POST',
        headers: {
          Host: 'auth.example.com',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          email: TEST_OPERATOR.email,
          password: TEST_OPERATOR.password
        })
      })
      expect(authLoginReq.status).toBe(200)
      const { token } = (await authLoginReq.json()) as { token: string }

      const authOverviewReq = await httpRequest({
        port: server.boundPort,
        path: '/v1/operator/overview',
        headers: {
          Host: 'auth.example.com',
          authorization: `Bearer ${token}`
        }
      })
      expect(authOverviewReq.status).toBe(200)
    } finally {
      await server.close()
    }
  })

  // Test 4: pairing list + revoke device + revoke grant
  it('4. pairing list + revoke device + revoke grant', async () => {
    const server = await listenOwnMobileRelay({
      operator: TEST_OPERATOR,
      origin: 'http://127.0.0.1'
    })
    try {
      const loginRes = await fetch(`${server.origin}/v1/operator/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: TEST_OPERATOR.email,
          password: TEST_OPERATOR.password
        })
      })
      const { token } = (await loginRes.json()) as { token: string }

      // Get pairing
      const pairRes = await fetch(`${server.origin}/v1/operator/pairing`, {
        headers: { authorization: `Bearer ${token}` }
      })
      expect(pairRes.status).toBe(200)
      const pairBody = (await pairRes.json()) as { devices: unknown[]; grants: unknown[] }
      expect(Array.isArray(pairBody.devices)).toBe(true)
      expect(Array.isArray(pairBody.grants)).toBe(true)

      // Revoke device
      const revokeDevRes = await fetch(
        `${server.origin}/v1/operator/pairing/devices/host-123/dev-456/revoke`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` }
        }
      )
      expect(revokeDevRes.status).toBe(200)
      expect(await revokeDevRes.json()).toEqual({ ok: true })

      // Revoke non-existent grant -> 404
      const revokeBadGrant = await fetch(
        `${server.origin}/v1/operator/pairing/grants/non-existent-grant/revoke`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` }
        }
      )
      expect(revokeBadGrant.status).toBe(404)
      expect(await revokeBadGrant.json()).toEqual({ error: 'not_found' })
    } finally {
      await server.close()
    }
  })

  // Test 5: events omit disallowed keys
  it('5. events omit disallowed keys and query filters work', async () => {
    const auditLog = createOwnMobileRelayAuditMemory()
    await auditLog.append({
      at: 1000,
      type: 'test.custom',
      fields: {
        relayHostId: 'host-xyz',
        accessToken: 'sensitive-token-should-not-exist',
        password: 'raw-password',
        reason: 'testing'
      } as unknown as Record<string, string | number | boolean | null>
    })
    await auditLog.append({
      at: 2000,
      type: 'test.second',
      fields: {
        deviceId: 'dev-abc',
        actor: 'user1'
      }
    })

    const server = await listenOwnMobileRelay({
      operator: TEST_OPERATOR,
      origin: 'http://127.0.0.1',
      auditLog
    })
    try {
      const loginRes = await fetch(`${server.origin}/v1/operator/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: TEST_OPERATOR.email,
          password: TEST_OPERATOR.password
        })
      })
      const { token } = (await loginRes.json()) as { token: string }

      const eventsRes = await fetch(`${server.origin}/v1/operator/events?since=500&limit=10`, {
        headers: { authorization: `Bearer ${token}` }
      })
      expect(eventsRes.status).toBe(200)
      const data = (await eventsRes.json()) as {
        events: { type: string; fields: Record<string, unknown> }[]
      }
      expect(data.events.length).toBeGreaterThanOrEqual(2)

      const stringified = JSON.stringify(data)
      expect(stringified).not.toContain('sensitive-token-should-not-exist')
      expect(stringified).not.toContain('raw-password')

      // Filter by type
      const filteredRes = await fetch(`${server.origin}/v1/operator/events?type=test.second`, {
        headers: { authorization: `Bearer ${token}` }
      })
      const filteredData = (await filteredRes.json()) as { events: { type: string }[] }
      expect(filteredData.events.every((e) => e.type === 'test.second')).toBe(true)
    } finally {
      await server.close()
    }
  })

  // Test 6: incident-bundle has no token-like strings in JSON.stringify output (scan)
  it('6. incident-bundle has no token-like strings in JSON.stringify output (scan)', async () => {
    const auditLog = createOwnMobileRelayAuditMemory()
    const server = await listenOwnMobileRelay({
      operator: TEST_OPERATOR,
      origin: 'http://127.0.0.1',
      auditLog
    })
    try {
      const loginRes = await fetch(`${server.origin}/v1/operator/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: TEST_OPERATOR.email,
          password: TEST_OPERATOR.password
        })
      })
      const { token } = (await loginRes.json()) as { token: string }

      const bundleRes = await fetch(`${server.origin}/v1/operator/incident-bundle`, {
        headers: { authorization: `Bearer ${token}` }
      })
      expect(bundleRes.status).toBe(200)
      const bundle = (await bundleRes.json()) as {
        generatedAt: number
        overview: object
        pairing: object
        events: unknown[]
        markdown: string
      }

      expect(typeof bundle.generatedAt).toBe('number')
      expect(bundle.overview).toBeDefined()
      expect(bundle.pairing).toBeDefined()
      expect(Array.isArray(bundle.events)).toBe(true)
      expect(typeof bundle.markdown).toBe('string')
      expect(bundle.markdown).toContain('hostControlLive')

      const stringified = JSON.stringify(bundle)

      // The operator token, operator password, or access token secrets must NEVER appear in the incident bundle
      expect(stringified).not.toContain(token)
      expect(stringified).not.toContain(TEST_OPERATOR.password)
      expect(stringified).not.toMatch(/"accessToken"/i)
      expect(stringified).not.toMatch(/"password"/i)
      expect(stringified).not.toMatch(/"rawRelayToken"/i)
      expect(stringified).not.toMatch(/"relayTokenHash"/i)
      expect(stringified).not.toMatch(/"currentResumeTokenHash"/i)
      expect(stringified).not.toMatch(/"graceResumeTokenHash"/i)
      expect(stringified).not.toMatch(/"tokenHash"/i)
    } finally {
      await server.close()
    }
  })
})
