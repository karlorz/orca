import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { loadConfig } from './config.js'

export const HOSTNAME = '127.0.0.1'

export function startServer() {
  const config = loadConfig()
  const app = createApp(config)

  return serve(
    {
      fetch: app.fetch,
      hostname: HOSTNAME,
      port: config.PORT
    },
    () => {
      // Loopback is intentional; operators may add authenticated Tailscale Serve separately.
      console.log(`Fork Live Status running: http://${HOSTNAME}:${config.PORT}`)
      console.log(`Coolify API: ${config.COOLIFY_API_URL}`)
    }
  )
}

if (process.env.NODE_ENV !== 'test' && import.meta.url === `file://${process.argv[1]}`) {
  startServer()
}
