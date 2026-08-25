import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DeviceRegistry } from './device-registry'
import { OrcaRuntimeRpcServer } from './runtime-rpc'
import { createMobileRpcSurfaceRuntime } from './runtime-rpc-mobile-method-allowlist-fixtures'

describe('OrcaRuntimeRpcServer pet.speak mobile allowlist', () => {
  it('allows pet.speak.unsubscribe on a mobile-scoped token', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'orca-runtime-rpc-pet-speak-'))
    const { runtime } = createMobileRpcSurfaceRuntime()
    const server = new OrcaRuntimeRpcServer({ runtime, userDataPath, enableWebSocket: false })
    server['deviceRegistry'] = new DeviceRegistry(userDataPath)
    const mobile = server['deviceRegistry']!.addDevice('phone', 'mobile')
    const replies: Record<string, unknown>[] = []
    await server['handleWebSocketMessage'](
      JSON.stringify({
        id: 'req_pet_speak_unsubscribe',
        method: 'pet.speak.unsubscribe',
        deviceToken: mobile.token,
        params: { subscriptionId: 'pet-speak-conn-1-1' }
      }),
      (response) => replies.push(JSON.parse(response) as Record<string, unknown>),
      () => {}
    )
    expect(replies).toContainEqual(
      expect.objectContaining({ id: 'req_pet_speak_unsubscribe', ok: true })
    )
  })
})
