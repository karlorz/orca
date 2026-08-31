import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  loadOwnRelayProtocolPathConfig,
  pathMatchesOwnRelayProtocolAllowlist,
  staleOwnRelayProtocolIncludeGlobs
} from './fork-own-relay-protocol-paths.mjs'

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

describe('own-relay protocol path allowlist', () => {
  const config = loadOwnRelayProtocolPathConfig(projectDir)

  it('matches host-proof, phone protocol, and rpc relay-transport', () => {
    expect(
      pathMatchesOwnRelayProtocolAllowlist('src/main/runtime/relay/relay-host-proof.ts', config)
    ).toBe(true)
    expect(
      pathMatchesOwnRelayProtocolAllowlist('src/shared/mobile-relay-phone-protocol.ts', config)
    ).toBe(true)
    expect(
      pathMatchesOwnRelayProtocolAllowlist('src/main/runtime/rpc/relay-transport.ts', config)
    ).toBe(true)
  })

  it('does not match SSH PTY daemon or hook-relay files', () => {
    expect(
      pathMatchesOwnRelayProtocolAllowlist('src/relay/pty-source-credit-ledger.ts', config)
    ).toBe(false)
    expect(pathMatchesOwnRelayProtocolAllowlist('src/shared/agent-hook-relay.ts', config)).toBe(
      false
    )
    expect(
      pathMatchesOwnRelayProtocolAllowlist(
        'src/main/runtime/relay/own-mobile-relay-http.ts',
        config
      )
    ).toBe(false)
  })

  it('reports no stale include globs against the live tree', () => {
    expect(staleOwnRelayProtocolIncludeGlobs(projectDir, config)).toEqual([])
  })
})
