import { Hono } from 'hono'
import type { LiveStatusConfig } from './config.js'
import { renderStatusHtml } from './html.js'
import { buildSnapshot } from './snapshot.js'

const CSP_HEADER = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "connect-src 'self'",
  "img-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'"
].join('; ')

const STATUS_HTML = renderStatusHtml()

export function createApp(config: LiveStatusConfig, fetchFn: typeof fetch = fetch): Hono {
  const app = new Hono()

  app.use('*', async (context, next) => {
    await next()
    context.header('Cache-Control', 'no-store')
    context.header('Content-Security-Policy', CSP_HEADER)
    context.header('Referrer-Policy', 'no-referrer')
    context.header('X-Content-Type-Options', 'nosniff')
    context.header('X-Frame-Options', 'DENY')
  })

  app.get('/health', (context) => context.json({ status: 'ok' }))

  app.get('/api/snapshot', async (context) => {
    try {
      const snapshot = await buildSnapshot(config, fetchFn)
      return context.json(snapshot)
    } catch {
      return context.json({ error: 'Failed to build status snapshot' }, 500)
    }
  })

  app.get('/', (context) => context.html(STATUS_HTML))

  return app
}
