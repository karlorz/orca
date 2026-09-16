import { describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import { loadConfig } from './config.js'
import { HOSTNAME } from './index.js'

describe('createApp HTTP handler', () => {
  const config = loadConfig({
    COOLIFY_API_TOKEN: 'secret-token-xyz'
  })

  const mockFetch = async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/v1/applications/')) {
      return new Response(JSON.stringify({ status: 'running', docker_image: 'repo/app:tag' }), {
        status: 200
      })
    }
    if (url.includes('/.well-known/jwks.json')) {
      return new Response(JSON.stringify({ keys: [{ kid: 'k1' }] }), { status: 200 })
    }
    return new Response('OK', { status: 200 })
  }

  const app = createApp(config, mockFetch)

  it('serves /health with 200 ok', async () => {
    const res = await app.request('/health')
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ status: 'ok' })
  })

  it('serves /api/snapshot without exposing token and includes security headers', async () => {
    const res = await app.request('/api/snapshot')
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(res.headers.get('X-Frame-Options')).toBe('DENY')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer')
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'self'")

    const body = await res.text()
    expect(body).not.toContain('secret-token-xyz')

    const data = JSON.parse(body)
    expect(data.rows).toHaveLength(2)
    expect(data.rows[0].id).toBe('own-auth')
    expect(data.rows[1].id).toBe('official-relay')
  })

  it('serves HTML on root GET /', async () => {
    const res = await app.request('/')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/html')
    const html = await res.text()
    expect(html).toContain('Orca Live Operator Status')
    expect(html).toContain('fetchStatus')
  })

  it('binds to loopback 127.0.0.1', () => {
    expect(HOSTNAME).toBe('127.0.0.1')
  })
})
