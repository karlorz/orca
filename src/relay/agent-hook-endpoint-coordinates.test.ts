import { describe, expect, it } from 'vitest'
import {
  buildRelayCodexHookLaunchArgEnv,
  buildRelayHookPtyEnv
} from './agent-hook-endpoint-coordinates'

describe('relay Codex hook launch argv authority', () => {
  it('keeps hook coordinates separate from final Codex argv authority', () => {
    expect(
      buildRelayHookPtyEnv({
        port: 43117,
        token: 'token-1',
        env: 'remote',
        endpointFilePath: '/tmp/endpoint.env',
        endpointFileWritten: true
      })
    ).toEqual({
      ORCA_AGENT_HOOK_PORT: '43117',
      ORCA_AGENT_HOOK_TOKEN: 'token-1',
      ORCA_AGENT_HOOK_ENV: 'remote',
      ORCA_AGENT_HOOK_VERSION: '1',
      ORCA_AGENT_HOOK_ENDPOINT: '/tmp/endpoint.env'
    })
  })

  it.each([{}, { ORCA_AGENT_HOOK_PORT: '43117' }, { ORCA_AGENT_HOOK_TOKEN: 'token-1' }])(
    'keeps both argv slots on an explicit safe disable without complete coordinates',
    (env) => {
      expect(buildRelayCodexHookLaunchArgEnv(env)).toEqual({
        ORCA_CODEX_HOOK_ENABLE_ARG: '-c',
        ORCA_CODEX_HOOK_FEATURE_ARG: 'features.hooks=false'
      })
    }
  )
})
