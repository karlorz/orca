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

  it('accepts login POST without Origin when Sec-Fetch-Site is same-origin', async () => {
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
          'sec-fetch-site': 'same-origin'
        },
        body: new URLSearchParams({
          email: TEST_OPERATOR.email,
          password: TEST_OPERATOR.password
        }).toString()
      })
      expect(login.status).toBe(303)
      expect(login.headers.location).toBe('/admin')
    } finally {
      await server.close()
    }
  })

  it('accepts login POST without Origin when Referer is on the auth origin', async () => {
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
          referer: 'http://127.0.0.1/admin/login'
        },
        body: new URLSearchParams({
          email: TEST_OPERATOR.email,
          password: TEST_OPERATOR.password
        }).toString()
      })
      expect(login.status).toBe(303)
    } finally {
      await server.close()
    }
  })

  it('still forbids login POST with a foreign Origin even if Referer matches', async () => {
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
          origin: 'https://evil.example',
          referer: 'http://127.0.0.1/admin/login'
        },
        body: new URLSearchParams({
          email: TEST_OPERATOR.email,
          password: TEST_OPERATOR.password
        }).toString()
      })
      expect(login.status).toBe(403)
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

  it('renders /admin/events in newest-first order', async () => {
    const { createOwnMobileRelayAuditMemory } = await import('./own-mobile-relay-audit-memory')
    const auditLog = createOwnMobileRelayAuditMemory()
    await auditLog.append({ at: 100, type: 'first.event', fields: { count: 1 } })
    await auditLog.append({ at: 200, type: 'second.event', fields: { count: 2 } })

    const server = await listenOwnMobileRelay({
      operator: TEST_OPERATOR,
      origin: 'http://127.0.0.1',
      auditLog
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
        path: '/admin/events',
        headers: { cookie }
      })
      expect(page.status).toBe(200)
      const html = await page.text()
      // second.event (at: 200) must appear before first.event (at: 100) in HTML table
      const idxFirst = html.indexOf('first.event')
      const idxSecond = html.indexOf('second.event')
      expect(idxSecond).toBeGreaterThan(-1)
      expect(idxFirst).toBeGreaterThan(-1)
      expect(idxSecond).toBeLessThan(idxFirst)
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

  it('Task 4: issued operator cookie becomes invalid after password reset (epoch bump) or account disable', async () => {
    const { openOwnMobileRelaySecurityStateSqlite } =
      await import('./own-mobile-relay-security-state-sqlite')
    const { derivePasswordRecord, TEST_FAST_PASSWORD_POLICY } =
      await import('./own-mobile-relay-password')
    const { mkdtemp, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')

    const tempDir = await mkdtemp(join(tmpdir(), 'orca-adm-task4-'))
    const dbPath = join(tempDir, 'security.db')
    const state = openOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: true })

    const adminPw = await derivePasswordRecord('admin-pwd-12345', TEST_FAST_PASSWORD_POLICY)
    const adminAccount = await state.bootstrapAccount({
      email: 'admin-cookie@example.com',
      userId: 'usr_adm_c',
      profileId: 'prf_adm_c',
      organizationId: 'org_main',
      passwordRecord: adminPw
    })

    // Add a second admin in sqlite
    const admin2 = await state.inviteAccount({
      email: 'admin-backup@example.com',
      userId: 'usr_adm_b',
      profileId: 'prf_adm_b',
      organizationId: 'org_main'
    })
    const admin2Pw = await derivePasswordRecord('backup-admin-pwd', TEST_FAST_PASSWORD_POLICY)
    await state.activateInvitedAccount(admin2.accountId, admin2Pw)
    // Promote admin2 to admin role
    const rawDb = (
      state._sqliteCtx as {
        db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } }
      }
    ).db
    rawDb
      .prepare("UPDATE operator_account SET role = 'admin' WHERE account_id = ?")
      .run(admin2.accountId)

    const server = await listenOwnMobileRelay({
      securityState: state,
      origin: 'http://127.0.0.1',
      passwordPolicy: TEST_FAST_PASSWORD_POLICY
    })

    try {
      // 1. Log in to get cookie
      const login = await httpRequest({
        port: server.boundPort,
        path: '/admin/login',
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          origin: 'http://127.0.0.1'
        },
        body: new URLSearchParams({
          email: 'admin-cookie@example.com',
          password: 'admin-pwd-12345'
        }).toString()
      })
      expect(login.status).toBe(303)
      const cookie = cookieFromSetCookie(login.headers['set-cookie'])

      // Access /admin with cookie -> 200
      const pageBefore = await httpRequest({
        port: server.boundPort,
        path: '/admin',
        headers: { cookie }
      })
      expect(pageBefore.status).toBe(200)

      // 2. Reset password via replacePasswordVerifier (bumps auth_epoch)
      const newAdminPw = await derivePasswordRecord(
        'admin-pwd-reset-999',
        TEST_FAST_PASSWORD_POLICY
      )
      const replaceRes = await state.replacePasswordVerifier(adminAccount.accountId, {
        expectedVerifierVersion: 1,
        newPasswordRecord: newAdminPw
      })
      expect(replaceRes.ok).toBe(true)

      // Old cookie must now be rejected and redirect to /admin/login
      const pageAfterEpochBump = await httpRequest({
        port: server.boundPort,
        path: '/admin',
        headers: { cookie }
      })
      expect(pageAfterEpochBump.status).toBe(302)
      expect(pageAfterEpochBump.headers.location).toBe('/admin/login')

      // 3. Log in again with new password to obtain fresh cookie
      const login2 = await httpRequest({
        port: server.boundPort,
        path: '/admin/login',
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          origin: 'http://127.0.0.1'
        },
        body: new URLSearchParams({
          email: 'admin-cookie@example.com',
          password: 'admin-pwd-reset-999'
        }).toString()
      })
      expect(login2.status).toBe(303)
      const cookie2 = cookieFromSetCookie(login2.headers['set-cookie'])

      const pageBeforeDisable = await httpRequest({
        port: server.boundPort,
        path: '/admin',
        headers: { cookie: cookie2 }
      })
      expect(pageBeforeDisable.status).toBe(200)

      // Disable first admin account
      const disableRes = await state.disableAccount(adminAccount.accountId)
      expect(disableRes).toBe('ok')

      // Cookie for disabled admin must now be rejected and redirect to /admin/login
      const pageAfterDisable = await httpRequest({
        port: server.boundPort,
        path: '/admin',
        headers: { cookie: cookie2 }
      })
      expect(pageAfterDisable.status).toBe(302)
      expect(pageAfterDisable.headers.location).toBe('/admin/login')
    } finally {
      await server.close()
      await state.close()
      await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
  })
})
