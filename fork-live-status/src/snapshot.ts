import type { LiveStatusConfig } from './config.js'
import { fetchCoolifyApp, type CoolifyAppRecord } from './coolify.js'
import { probeHttp, probeJwks, type JwksProbeResult, type ProbeResult } from './probe.js'

export type AuthRowSnapshot = {
  id: 'own-auth'
  name: string
  origin: string
  coolifyUuid: string
  coolify: CoolifyAppRecord
  probes: {
    health: ProbeResult
    jwks: JwksProbeResult
  }
}

export type RelayRowSnapshot = {
  id: 'official-relay'
  name: string
  origin: string
  coolifyUuid: string
  coolify: CoolifyAppRecord
  probes: {
    health: ProbeResult
    ready: ProbeResult
  }
}

export type SystemSnapshot = {
  timestamp: string
  rows: [AuthRowSnapshot, RelayRowSnapshot]
}

export async function buildSnapshot(
  config: LiveStatusConfig,
  fetchFn: typeof fetch = fetch
): Promise<SystemSnapshot> {
  const authOrigin = config.FORK_LIVE_STATUS_AUTH_ORIGIN.replace(/\/+$/, '')
  const relayOrigin = config.FORK_LIVE_STATUS_RELAY_ORIGIN.replace(/\/+$/, '')

  const [authCoolify, relayCoolify, authHealth, authJwks, relayHealth, relayReady] =
    await Promise.all([
      fetchCoolifyApp(
        config.COOLIFY_API_URL,
        config.COOLIFY_API_TOKEN,
        config.FORK_LIVE_STATUS_AUTH_APP_UUID,
        fetchFn
      ),
      fetchCoolifyApp(
        config.COOLIFY_API_URL,
        config.COOLIFY_API_TOKEN,
        config.FORK_LIVE_STATUS_RELAY_APP_UUID,
        fetchFn
      ),
      probeHttp(`${authOrigin}/health`, fetchFn),
      probeJwks(`${authOrigin}/.well-known/jwks.json`, fetchFn),
      probeHttp(`${relayOrigin}/health`, fetchFn),
      probeHttp(`${relayOrigin}/ready`, fetchFn)
    ])

  const authRow: AuthRowSnapshot = {
    id: 'own-auth',
    name: 'own-auth',
    origin: authOrigin,
    coolifyUuid: config.FORK_LIVE_STATUS_AUTH_APP_UUID,
    coolify: authCoolify,
    probes: {
      health: authHealth,
      jwks: authJwks
    }
  }

  const relayRow: RelayRowSnapshot = {
    id: 'official-relay',
    name: 'official combined',
    origin: relayOrigin,
    coolifyUuid: config.FORK_LIVE_STATUS_RELAY_APP_UUID,
    coolify: relayCoolify,
    probes: {
      health: relayHealth,
      ready: relayReady
    }
  }

  return {
    timestamp: new Date().toISOString(),
    rows: [authRow, relayRow]
  }
}
