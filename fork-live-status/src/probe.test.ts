import { describe, expect, it } from 'vitest'
import { probeHttp, probeJwks } from './probe.js'

describe('probeHttp', () => {
  it('returns ok on HTTP 200', async () => {
    const mockFetch = async () => new Response('OK', { status: 200 })
    const res = await probeHttp('https://orca-relay.karldigi.dev/health', mockFetch)
    expect(res.status).toBe('ok')
    expect(res.httpStatus).toBe(200)
    expect(res.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('returns error on HTTP 500', async () => {
    const mockFetch = async () =>
      new Response('Server error', { status: 500, statusText: 'Internal Server Error' })
    const res = await probeHttp('https://orca-relay.karldigi.dev/health', mockFetch)
    expect(res.status).toBe('error')
    expect(res.httpStatus).toBe(500)
    expect(res.detail).toContain('HTTP 500: Internal Server Error')
  })
})

describe('probeJwks', () => {
  it('counts keys and extracts kids from valid JWKS payload', async () => {
    const fixture = {
      keys: [
        { kty: 'EC', kid: 'key-1', crv: 'P-256', x: 'secret-x', y: 'secret-y' },
        { kty: 'EC', kid: 'key-2', crv: 'P-256', x: 'secret-x2', y: 'secret-y2' }
      ]
    }
    const mockFetch = async () => new Response(JSON.stringify(fixture), { status: 200 })
    const res = await probeJwks('https://orca-auth.karldigi.dev/.well-known/jwks.json', mockFetch)
    expect(res.status).toBe('ok')
    expect(res.httpStatus).toBe(200)
    expect(res.keyCount).toBe(2)
    expect(res.kids).toEqual(['key-1', 'key-2'])
    expect(JSON.stringify(res)).not.toContain('secret-x')
    expect(JSON.stringify(res)).not.toContain('P-256')
  })

  it('fails JWKS probe if response is non-200', async () => {
    const mockFetch = async () =>
      new Response('Not Found', { status: 404, statusText: 'Not Found' })
    const res = await probeJwks('https://orca-auth.karldigi.dev/.well-known/jwks.json', mockFetch)
    expect(res.status).toBe('error')
    expect(res.httpStatus).toBe(404)
    expect(res.keyCount).toBeUndefined()
    expect(res.kids).toBeUndefined()
  })

  it('fails JWKS probe if JSON has no keys array', async () => {
    const mockFetch = async () =>
      new Response(JSON.stringify({ error: 'no keys' }), { status: 200 })
    const res = await probeJwks('https://orca-auth.karldigi.dev/.well-known/jwks.json', mockFetch)
    expect(res.status).toBe('error')
    expect(res.detail).toContain('missing keys array')
    expect(res.keyCount).toBeUndefined()
  })
})
