import { describe, expect, it } from 'vitest'
import http from 'node:http'
import { rm } from 'node:fs/promises'
import { listenOwnMobileRelay } from './own-mobile-relay-http'
import { TEST_OPERATOR } from './own-mobile-relay-test-auth'
import { createOwnMobileRelaySecurityStateSqlite } from './own-mobile-relay-security-state-sqlite'
import {
  derivePasswordRecord,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  TEST_FAST_PASSWORD_POLICY
} from './own-mobile-relay-password'
import { createOwnMobileRelayAuditMemory } from './own-mobile-relay-audit-memory'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

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

describe('OwnMobileRelay /admin/users Users Page', () => {
  it('redirects unauthenticated /admin/users to /admin/login', async () => {
    const server = await listenOwnMobileRelay({
      operator: TEST_OPERATOR,
      origin: 'http://127.0.0.1'
    })
    try {
      const res = await httpRequest({ port: server.boundPort, path: '/admin/users' })
      expect(res.status).toBe(302)
      expect(res.headers.location).toBe('/admin/login')
    } finally {
      await server.close()
    }
  })

  it('renders users page without pairing column and allows invite, activate, reset, disable with audit events', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'orca-admin-users-test-'))
    const dbPath = join(tempDir, 'security.db')
    const state = createOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: true })
    const auditLog = createOwnMobileRelayAuditMemory()

    const adminPw = await derivePasswordRecord('admin-pwd-12345', TEST_FAST_PASSWORD_POLICY)
    const admin = await state.bootstrapAccount({
      email: 'admin@example.com',
      userId: 'usr_admin',
      profileId: 'prf_admin',
      organizationId: 'org_admin',
      passwordRecord: adminPw
    })

    const server = await listenOwnMobileRelay({
      origin: 'http://127.0.0.1',
      securityState: state,
      auditLog,
      passwordPolicy: TEST_FAST_PASSWORD_POLICY
    })

    try {
      // 1. Log in as admin
      const login = await httpRequest({
        port: server.boundPort,
        path: '/admin/login',
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          origin: 'http://127.0.0.1'
        },
        body: new URLSearchParams({
          email: 'admin@example.com',
          password: 'admin-pwd-12345'
        }).toString()
      })
      expect(login.status).toBe(303)
      const cookie = cookieFromSetCookie(login.headers['set-cookie'])
      expect(cookie.startsWith('own_relay_operator=')).toBe(true)

      // Path of cookie must be /admin
      const rawSetCookie = login.headers['set-cookie']
      const setCookieStr = Array.isArray(rawSetCookie) ? rawSetCookie[0] : rawSetCookie
      expect(setCookieStr).toContain('Path=/admin')

      // 2. GET /admin/users
      const usersPage = await httpRequest({
        port: server.boundPort,
        path: '/admin/users',
        headers: { cookie }
      })
      expect(usersPage.status).toBe(200)
      const pageHtml = await usersPage.text()

      // Verify NO pairing column on the Users table
      expect(pageHtml).toContain('<th>Email</th><th>Role</th><th>Status</th><th>Actions</th>')
      expect(pageHtml.toLowerCase()).not.toContain('relaydeviceid')
      expect(pageHtml.toLowerCase()).not.toContain('relayhostid')
      expect(pageHtml).toContain('admin@example.com')
      expect(pageHtml).toContain('you')

      // 3. POST /admin/users/invite
      const inviteRes = await httpRequest({
        port: server.boundPort,
        path: '/admin/users/invite',
        method: 'POST',
        headers: {
          cookie,
          'content-type': 'application/x-www-form-urlencoded',
          origin: 'http://127.0.0.1'
        },
        body: new URLSearchParams({
          email: 'newuser@example.com'
        }).toString()
      })
      expect(inviteRes.status).toBe(303)
      expect(inviteRes.headers.location).toBe('/admin/users')

      const invitedAccount = await state.getAccount({ email: 'newuser@example.com' })
      expect(invitedAccount).not.toBeNull()
      expect(invitedAccount?.status).toBe('invited')
      expect(invitedAccount?.role).toBe('user')

      // Verify audit log for invite
      const inviteEvents = await auditLog.list({ type: 'user.invited' })
      expect(inviteEvents.length).toBe(1)
      expect(inviteEvents[0].fields.email).toBe('newuser@example.com')
      expect(inviteEvents[0].fields.actorAccountId).toBe(admin.accountId)

      // 4. POST /admin/users/:id/activate
      const activateRes = await httpRequest({
        port: server.boundPort,
        path: `/admin/users/${encodeURIComponent(invitedAccount!.accountId)}/activate`,
        method: 'POST',
        headers: {
          cookie,
          'content-type': 'application/x-www-form-urlencoded',
          origin: 'http://127.0.0.1'
        },
        body: new URLSearchParams({
          password: 'new-user-password-123'
        }).toString()
      })
      expect(activateRes.status).toBe(303)
      expect(activateRes.headers.location).toBe('/admin/users')

      const activatedAccount = await state.getAccount({ accountId: invitedAccount!.accountId })
      expect(activatedAccount?.status).toBe('active')
      expect(activatedAccount?.authEpoch).toBe(1)

      const activateEvents = await auditLog.list({ type: 'user.activated' })
      expect(activateEvents.length).toBe(1)
      expect(activateEvents[0].fields.accountId).toBe(invitedAccount!.accountId)

      // 5. POST /admin/users/:id/reset (bumps epoch)
      const resetRes = await httpRequest({
        port: server.boundPort,
        path: `/admin/users/${encodeURIComponent(invitedAccount!.accountId)}/reset`,
        method: 'POST',
        headers: {
          cookie,
          'content-type': 'application/x-www-form-urlencoded',
          origin: 'http://127.0.0.1'
        },
        body: new URLSearchParams({
          password: 'new-user-reset-pwd-456'
        }).toString()
      })
      expect(resetRes.status).toBe(303)
      expect(resetRes.headers.location).toBe('/admin/users')

      const resetAccount = await state.getAccount({ accountId: invitedAccount!.accountId })
      expect(resetAccount?.status).toBe('active')
      expect(resetAccount?.authEpoch).toBe(2)

      const resetEvents = await auditLog.list({ type: 'user.password_reset' })
      expect(resetEvents.length).toBe(1)
      expect(resetEvents[0].fields.accountId).toBe(invitedAccount!.accountId)

      // 6. POST /admin/users/:id/disable
      const disableRes = await httpRequest({
        port: server.boundPort,
        path: `/admin/users/${encodeURIComponent(invitedAccount!.accountId)}/disable`,
        method: 'POST',
        headers: {
          cookie,
          'content-type': 'application/x-www-form-urlencoded',
          origin: 'http://127.0.0.1'
        },
        body: ''
      })
      expect(disableRes.status).toBe(303)
      expect(disableRes.headers.location).toBe('/admin/users')

      const disabledAccount = await state.getAccount({ accountId: invitedAccount!.accountId })
      expect(disabledAccount?.status).toBe('disabled')
      expect(disabledAccount?.authEpoch).toBe(3)

      const disableEvents = await auditLog.list({ type: 'user.disabled' })
      expect(disableEvents.length).toBe(1)
      expect(disableEvents[0].fields.accountId).toBe(invitedAccount!.accountId)

      // 7. IDOR tests:
      // a) Non-existent account ID -> 404
      const idor404 = await httpRequest({
        port: server.boundPort,
        path: '/admin/users/non_existent_account_xyz/reset',
        method: 'POST',
        headers: {
          cookie,
          'content-type': 'application/x-www-form-urlencoded',
          origin: 'http://127.0.0.1'
        },
        body: new URLSearchParams({ password: 'some-password-123' }).toString()
      })
      expect(idor404.status).toBe(404)

      for (const action of ['activate', 'reset', 'disable']) {
        const malformedId = await httpRequest({
          port: server.boundPort,
          path: `/admin/users/%E0%A4%A/${action}`,
          method: 'POST',
          headers: { cookie, origin: 'http://127.0.0.1' }
        })
        expect(malformedId.status).toBe(400)
      }
      const afterMalformedId = await httpRequest({
        port: server.boundPort,
        path: '/admin/users',
        headers: { cookie }
      })
      expect(afterMalformedId.status).toBe(200)

      // b) Admin cannot disable self -> 403
      const selfDisable = await httpRequest({
        port: server.boundPort,
        path: `/admin/users/${encodeURIComponent(admin.accountId)}/disable`,
        method: 'POST',
        headers: {
          cookie,
          'content-type': 'application/x-www-form-urlencoded',
          origin: 'http://127.0.0.1'
        },
        body: ''
      })
      expect(selfDisable.status).toBe(403)

      // c) CSRF protection: bad origin -> 403
      const csrfBadOrigin = await httpRequest({
        port: server.boundPort,
        path: '/admin/users/invite',
        method: 'POST',
        headers: {
          cookie,
          'content-type': 'application/x-www-form-urlencoded',
          origin: 'http://attacker.example.com'
        },
        body: new URLSearchParams({ email: 'hacker@example.com' }).toString()
      })
      expect(csrfBadOrigin.status).toBe(403)
    } finally {
      await server.close()
      await state.close()
      await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
  })

  it('returns 400 for an 8-13 character activate or reset password and keeps serving', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'orca-admin-users-short-pw-'))
    const dbPath = join(tempDir, 'security.db')
    const state = createOwnMobileRelaySecurityStateSqlite({ dbPath, testMode: true })
    const auditLog = createOwnMobileRelayAuditMemory()
    const adminPw = await derivePasswordRecord('admin-pwd-12345', TEST_FAST_PASSWORD_POLICY)
    await state.bootstrapAccount({
      email: 'admin@example.com',
      userId: 'usr_admin',
      profileId: 'prf_admin',
      organizationId: 'org_admin',
      passwordRecord: adminPw
    })
    const invited = await state.inviteAccount({
      email: 'shortpw@example.com',
      userId: 'usr_short',
      profileId: 'prf_short',
      organizationId: 'org_admin'
    })

    const server = await listenOwnMobileRelay({
      origin: 'http://127.0.0.1',
      securityState: state,
      auditLog,
      passwordPolicy: TEST_FAST_PASSWORD_POLICY
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
          email: 'admin@example.com',
          password: 'admin-pwd-12345'
        }).toString()
      })
      expect(login.status).toBe(303)
      const cookie = cookieFromSetCookie(login.headers['set-cookie'])

      const nineChars = 'nine-chars'
      expect(nineChars.length).toBeGreaterThanOrEqual(8)
      expect(nineChars.length).toBeLessThan(MIN_PASSWORD_LENGTH)

      const activateRes = await httpRequest({
        port: server.boundPort,
        path: `/admin/users/${encodeURIComponent(invited.accountId)}/activate`,
        method: 'POST',
        headers: {
          cookie,
          'content-type': 'application/x-www-form-urlencoded',
          origin: 'http://127.0.0.1'
        },
        body: new URLSearchParams({ password: nineChars }).toString()
      })
      expect(activateRes.status).toBe(400)
      expect(await activateRes.text()).toContain(
        `Password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters`
      )
      expect((await state.getAccount({ accountId: invited.accountId }))?.status).toBe('invited')

      const stillUp = await httpRequest({
        port: server.boundPort,
        path: '/admin/users',
        headers: { cookie }
      })
      expect(stillUp.status).toBe(200)

      const activateOk = await httpRequest({
        port: server.boundPort,
        path: `/admin/users/${encodeURIComponent(invited.accountId)}/activate`,
        method: 'POST',
        headers: {
          cookie,
          'content-type': 'application/x-www-form-urlencoded',
          origin: 'http://127.0.0.1'
        },
        body: new URLSearchParams({ password: 'new-user-password-123' }).toString()
      })
      expect(activateOk.status).toBe(303)

      const thirteenChars = 'thirteen-char'
      expect(thirteenChars.length).toBe(13)
      expect(thirteenChars.length).toBeLessThan(MIN_PASSWORD_LENGTH)
      const resetRes = await httpRequest({
        port: server.boundPort,
        path: `/admin/users/${encodeURIComponent(invited.accountId)}/reset`,
        method: 'POST',
        headers: {
          cookie,
          'content-type': 'application/x-www-form-urlencoded',
          origin: 'http://127.0.0.1'
        },
        body: new URLSearchParams({ password: thirteenChars }).toString()
      })
      expect(resetRes.status).toBe(400)
      expect(await resetRes.text()).toContain(
        `Password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters`
      )

      const afterReset = await httpRequest({
        port: server.boundPort,
        path: '/admin/users',
        headers: { cookie }
      })
      expect(afterReset.status).toBe(200)
    } finally {
      await server.close()
      await state.close()
      await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
  })
})
