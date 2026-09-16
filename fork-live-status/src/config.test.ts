import { describe, expect, it } from 'vitest'
import { loadConfig } from './config.js'

describe('config', () => {
  it('loads default values without a Coolify token', () => {
    const config = loadConfig({})
    expect(config.PORT).toBe(2477)
    expect(config.COOLIFY_API_URL).toBe('https://cp.karldigi.dev')
    expect(config.COOLIFY_API_TOKEN).toBe('')
    expect(config.FORK_LIVE_STATUS_AUTH_ORIGIN).toBe('https://orca-auth.karldigi.dev')
    expect(config.FORK_LIVE_STATUS_RELAY_ORIGIN).toBe('https://orca-relay.karldigi.dev')
    expect(config.FORK_LIVE_STATUS_AUTH_APP_UUID).toBe('bfxz2ef22nep35ytcv6qqj0t')
    expect(config.FORK_LIVE_STATUS_RELAY_APP_UUID).toBe('kl8ypbofi72soo46ha1cr85i')
  })

  it('accepts a Coolify token', () => {
    const config = loadConfig({
      COOLIFY_API_TOKEN: 'secret-token-123'
    })
    expect(config.COOLIFY_API_TOKEN).toBe('secret-token-123')
  })
})
