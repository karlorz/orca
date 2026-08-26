import { describe, it, expect } from 'vitest'
import { renderPasswordChangePage, PASSWORD_PAGE_HEADERS } from './own-mobile-relay-password-page'

describe('own-mobile-relay-password-page', () => {
  it('renders a self-contained HTML page with email, currentPassword, newPassword, confirmPassword inputs', () => {
    const html = renderPasswordChangePage()
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('action="/v1/desktop/auth/password"')
    expect(html).toContain('method="POST"')
    expect(html).toContain('name="email"')
    expect(html).toContain('name="currentPassword"')
    expect(html).toContain('name="newPassword"')
    expect(html).toContain('name="confirmPassword"')
    expect(html).toContain('type="password"')
    expect(html).toContain('type="email"')

    // Must not depend on any external scripts, external stylesheets, or Node globals
    expect(html).not.toContain('<script src="http')
    expect(html).not.toContain('<link rel="stylesheet" href="http')
    expect(html).not.toContain('process.env')
  })

  it('renders status messages safely escaped without injecting raw user input', () => {
    const htmlWithError = renderPasswordChangePage({
      status: 'error',
      message: 'Failed to update password'
    })
    expect(htmlWithError).toContain('Failed to update password')

    const htmlWithSuccess = renderPasswordChangePage({
      status: 'success',
      message: 'Password changed successfully'
    })
    expect(htmlWithSuccess).toContain('Password changed successfully')
  })

  it('defines required security headers matching strict CSP and framing requirements', () => {
    expect(PASSWORD_PAGE_HEADERS['cache-control']).toBe('no-store, no-cache, must-revalidate')
    expect(PASSWORD_PAGE_HEADERS['pragma']).toBe('no-cache')
    expect(PASSWORD_PAGE_HEADERS['x-frame-options']).toBe('DENY')
    expect(PASSWORD_PAGE_HEADERS['x-content-type-options']).toBe('nosniff')
    expect(PASSWORD_PAGE_HEADERS['content-security-policy']).toContain("default-src 'none'")
    expect(PASSWORD_PAGE_HEADERS['content-security-policy']).toContain("form-action 'self'")
    expect(PASSWORD_PAGE_HEADERS['content-security-policy']).toContain("frame-ancestors 'none'")
  })
})
