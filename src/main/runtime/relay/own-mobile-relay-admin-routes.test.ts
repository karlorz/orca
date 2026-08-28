import { describe, expect, it } from 'vitest'
import http from 'node:http'
import { listenOwnMobileRelay } from './own-mobile-relay-http'
import { TEST_OPERATOR } from './own-mobile-relay-test-auth'

function httpRequest(options: {
  port: number
  path: string
  method?: string
  headers?: Record<string, string>
  body?: string
}): Promise<{ status: number; headers: http.IncomingHttpHeaders; text: () => Promise<string> }> {
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
            text: async () => raw
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

function cookieFromSetCookie(setCookie: string | string[] | undefined): string {
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie
  if (!raw) {
    return ''
  }
  return raw.split(';')[0] ?? ''
}

describe('OwnMobileRelay /admin HTML', () => {
  it('redirects unauthenticated /admin to login', async () => {
    const server = await listenOwnMobileRelay({
      operator: TEST_OPERATOR,
      origin: 'http://127.0.0.1'
    })
    try {
      const res = await httpRequest({ port: server.boundPort, path: '/admin' })
      expect(res.status).toBe(302)
      expect(res.headers.location).toBe('/admin/login')
    } finally {
      await server.close()
    }
  })

  it('logs in with a form POST and shows overview', async () => {
    const server = await listenOwnMobileRelay({
      operator: TEST_OPERATOR,
      origin: 'http://127.0.0.1'
    })
    try {
      const login = await httpRequest({
        port: server.boundPort,
        path: '/admin/login',
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          origin: 'http://127.0.0.1'
        },
        body: new URLSearchParams({
          email: TEST_OPERATOR.email,
          password: TEST_OPERATOR.password
        }).toString()
      })
      expect(login.status).toBe(303)
      expect(login.headers.location).toBe('/admin')
      const cookie = cookieFromSetCookie(login.headers['set-cookie'])
      expect(cookie.startsWith('own_relay_operator=')).toBe(true)
      const page = await httpRequest({
        port: server.boundPort,
        path: '/admin',
        headers: { cookie }
      })
      expect(page.status).toBe(200)
      const html = await page.text()
      expect(html).toContain('hostControlLive')
      expect(html).not.toContain(TEST_OPERATOR.password)
    } finally {
      await server.close()
    }
  })

  it('returns 404 for /admin on the cell origin', async () => {
    const server = await listenOwnMobileRelay({
      operator: TEST_OPERATOR,
      origin: 'https://cell.example.com',
      authOrigin: 'https://auth.example.com'
    })
    try {
      const res = await httpRequest({
        port: server.boundPort,
        path: '/admin',
        headers: { Host: 'cell.example.com' }
      })
      expect(res.status).toBe(404)
    } finally {
      await server.close()
    }
  })

  it('rejects pairing revoke without Origin and accepts matching Origin', async () => {
    const server = await listenOwnMobileRelay({
      operator: TEST_OPERATOR,
      origin: 'http://127.0.0.1'
    })
    try {
      const login = await httpRequest({
        port: server.boundPort,
        path: '/admin/login',
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          origin: 'http://127.0.0.1'
        },
        body: new URLSearchParams({
          email: TEST_OPERATOR.email,
          password: TEST_OPERATOR.password
        }).toString()
      })
      const cookie = cookieFromSetCookie(login.headers['set-cookie'])
      const forbidden = await httpRequest({
        port: server.boundPort,
        path: '/admin/pairing/devices/host1/dev1/revoke',
        method: 'POST',
        headers: {
          cookie,
          'content-type': 'application/x-www-form-urlencoded'
        }
      })
      expect(forbidden.status).toBe(403)
      const ok = await httpRequest({
        port: server.boundPort,
        path: '/admin/pairing/devices/host1/dev1/revoke',
        method: 'POST',
        headers: {
          cookie,
          origin: 'http://127.0.0.1',
          'content-type': 'application/x-www-form-urlencoded'
        }
      })
      expect(ok.status).toBe(303)
    } finally {
      await server.close()
    }
  })

  it('renders /admin/incident with markdown bundle for authenticated operator and excludes operator password', async () => {
    const server = await listenOwnMobileRelay({
      operator: TEST_OPERATOR,
      origin: 'http://127.0.0.1'
    })
    try {
      const login = await httpRequest({
        port: server.boundPort,
        path: '/admin/login',
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          origin: 'http://127.0.0.1'
        },
        body: new URLSearchParams({
          email: TEST_OPERATOR.email,
          password: TEST_OPERATOR.password
        }).toString()
      })
      const cookie = cookieFromSetCookie(login.headers['set-cookie'])
      const page = await httpRequest({
        port: server.boundPort,
        path: '/admin/incident',
        headers: { cookie }
      })
      expect(page.status).toBe(200)
      const html = await page.text()
      expect(html).toContain('hostControlLive')
      expect(html).toContain('# Own Relay Operator Incident Bundle')
      expect(html).toContain('Incident')
      expect(html).not.toContain(TEST_OPERATOR.password)
    } finally {
      await server.close()
    }
  })
})
