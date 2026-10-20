import './rpc/unused-default-rpc-methods.test-fixture'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'
import { OrcaRuntimeRpcServer } from './runtime-rpc'
import { PAIRING_METHODS } from './rpc/methods/pairing'

const SENTINEL = 'orca://pair#test-sentinel-runtime-offer'

function localRequest(authToken: string, params: unknown = {}) {
  return JSON.stringify({
    id: 'req-1',
    authToken,
    method: 'pairing.createOffer',
    params
  })
}

describe('local owner runtime pairing offers', () => {
  it('dispatches authenticated Unix owner calls through createPairingOffer', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'orca-runtime-rpc-runtime-offer-'))
    const server = new OrcaRuntimeRpcServer({
      methods: PAIRING_METHODS,
      runtime: new OrcaRuntimeService(),
      userDataPath,
      enableWebSocket: false
    })
    const createPairingOffer = vi.spyOn(server, 'createPairingOffer').mockReturnValue({
      available: true,
      pairingUrl: SENTINEL,
      endpoint: 'ws://192.168.1.24:6768',
      deviceId: 'device-1',
      webClientUrl: null
    })

    const response = await server['handleMessage'](
      localRequest(server['authToken'], { address: '192.168.1.24', rotate: true })
    )
    expect(response).toMatchObject({
      ok: true,
      result: { available: true, pairingUrl: SENTINEL, deviceId: 'device-1' }
    })
    expect(createPairingOffer).toHaveBeenCalledWith({
      address: '192.168.1.24',
      rotate: true,
      scope: 'runtime'
    })
  })

  it('never mints for a bad auth token', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'orca-runtime-rpc-runtime-offer-'))
    const server = new OrcaRuntimeRpcServer({
      methods: PAIRING_METHODS,
      runtime: new OrcaRuntimeService(),
      userDataPath,
      enableWebSocket: false
    })
    const createPairingOffer = vi.spyOn(server, 'createPairingOffer')

    const response = await server['handleMessage'](localRequest('not-the-token', { rotate: true }))
    expect(response).toMatchObject({ ok: false, error: { code: 'unauthorized' } })
    expect(createPairingOffer).not.toHaveBeenCalled()
  })
})
