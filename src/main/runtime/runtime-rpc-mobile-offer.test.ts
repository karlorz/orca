import './rpc/unused-default-rpc-methods.test-fixture'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'
import { OrcaRuntimeRpcServer } from './runtime-rpc'
import { PAIRING_METHODS } from './rpc/methods/pairing'

const SENTINEL = 'orca://pair#test-sentinel-mobile-offer'

function localRequest(authToken: string, params: unknown = {}) {
  return JSON.stringify({
    id: 'req-1',
    authToken,
    method: 'pairing.createMobileOffer',
    params
  })
}

describe('local owner mobile pairing offers', () => {
  it('dispatches authenticated local owner calls to the registered hook', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'orca-runtime-rpc-mobile-offer-'))
    const server = new OrcaRuntimeRpcServer({
      methods: PAIRING_METHODS,
      runtime: new OrcaRuntimeService(),
      userDataPath,
      enableWebSocket: false
    })
    const create = vi.fn().mockResolvedValue({
      available: true,
      pairingUrl: SENTINEL,
      endpoint: null,
      deviceId: 'device-1',
      connectionMode: 'automatic'
    })
    server.setMobilePairingOffers({ create })

    const response = await server['handleMessage'](
      localRequest(server['authToken'], { rotate: true })
    )
    expect(response).toMatchObject({
      ok: true,
      result: { available: true, pairingUrl: SENTINEL, deviceId: 'device-1' }
    })
    expect(create).toHaveBeenCalledWith({ rotate: true })
  })

  it('does not mint when the desktop hook is absent', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'orca-runtime-rpc-mobile-offer-'))
    const server = new OrcaRuntimeRpcServer({
      methods: PAIRING_METHODS,
      runtime: new OrcaRuntimeService(),
      userDataPath,
      enableWebSocket: false
    })
    const create = vi.fn()

    const response = await server['handleMessage'](localRequest(server['authToken']))
    expect(response).toMatchObject({
      ok: false,
      error: { code: 'mobile_pairing_offer_unavailable' }
    })
    expect(create).not.toHaveBeenCalled()
  })

  it('never invokes the hook for a bad auth token', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'orca-runtime-rpc-mobile-offer-'))
    const server = new OrcaRuntimeRpcServer({
      methods: PAIRING_METHODS,
      runtime: new OrcaRuntimeService(),
      userDataPath,
      enableWebSocket: false
    })
    const create = vi.fn()
    server.setMobilePairingOffers({ create })

    const response = await server['handleMessage'](localRequest('not-the-token'))
    expect(response).toMatchObject({ ok: false, error: { code: 'unauthorized' } })
    expect(create).not.toHaveBeenCalled()
  })
})
