import { describe, expect, it } from 'vitest'
import { fetchCoolifyApp } from './coolify.js'

describe('fetchCoolifyApp', () => {
  it('parses app record with docker_image correctly', async () => {
    const fixture = {
      uuid: 'bfxz2ef22nep35ytcv6qqj0t',
      name: 'own-auth',
      status: 'running',
      docker_image: 'ghcr.io/karlorz/orca-auth:latest'
    }

    const mockFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(
        'https://cp.karldigi.dev/api/v1/applications/bfxz2ef22nep35ytcv6qqj0t'
      )
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-token')
      return new Response(JSON.stringify(fixture), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const result = await fetchCoolifyApp(
      'https://cp.karldigi.dev',
      'test-token',
      fixture.uuid,
      mockFetch
    )
    expect(result.uuid).toBe(fixture.uuid)
    expect(result.name).toBe(fixture.name)
    expect(result.status).toBe(fixture.status)
    expect(result.image).toBe(fixture.docker_image)
    expect(result.error).toBeUndefined()
  })

  it('unwraps Coolify { data } payloads and running:healthy status', async () => {
    const fixture = {
      data: {
        uuid: 'kl8ypbofi72soo46ha1cr85i',
        name: 'orca-relay-official',
        status: 'running:healthy',
        docker_registry_image_name: 'ghcr.io/karlorz/orca-relay-official:e80f3d749f'
      }
    }
    const mockFetch = async () => new Response(JSON.stringify(fixture), { status: 200 })
    const result = await fetchCoolifyApp(
      'https://cp.karldigi.dev',
      'test-token',
      'kl8ypbofi72soo46ha1cr85i',
      mockFetch
    )
    expect(result.status).toBe(fixture.data.status)
    expect(result.image).toBe(fixture.data.docker_registry_image_name)
    expect(result.name).toBe(fixture.data.name)
  })

  it('handles 401/404 error without throwing', async () => {
    const mockFetch = async () =>
      new Response('Unauthorized', {
        status: 401,
        statusText: 'Unauthorized'
      })

    const result = await fetchCoolifyApp(
      'https://cp.karldigi.dev',
      'bad-token',
      'some-uuid',
      mockFetch
    )
    expect(result.uuid).toBe('some-uuid')
    expect(result.status).toBe('error')
    expect(result.error).toContain('HTTP 401: Unauthorized')
  })

  it('handles fetch exception gracefully', async () => {
    const mockFetch = async () => {
      throw new Error('Connection refused')
    }

    const result = await fetchCoolifyApp(
      'https://cp.karldigi.dev',
      'test-token',
      'some-uuid',
      mockFetch
    )
    expect(result.uuid).toBe('some-uuid')
    expect(result.status).toBe('error')
    expect(result.error).toContain('Connection refused')
  })
})
