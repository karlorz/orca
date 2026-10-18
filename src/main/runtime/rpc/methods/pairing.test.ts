import '../unused-default-rpc-methods.test-fixture'
import { describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { RpcDispatcher } from '../dispatcher'
import { PAIRING_METHODS } from './pairing'

function dispatchPairing(
  method: string,
  params: unknown,
  options: NonNullable<Parameters<RpcDispatcher['dispatchStreaming']>[2]> = {}
): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const runtime = { getRuntimeId: () => 'test-runtime' }
    const dispatcher = new RpcDispatcher({
      runtime: runtime as OrcaRuntimeService,
      methods: PAIRING_METHODS
    })
    void dispatcher.dispatchStreaming(
      { id: 'request-1', authToken: '', method, params },
      (response) => resolve(JSON.parse(response) as Record<string, unknown>),
      options
    )
  })
}

describe('pairing RPC methods', () => {
  it('passes only phone-owned credential material to the server-bound provider', async () => {
    const provisionRelay = vi.fn().mockResolvedValue({
      v: 1,
      reqId: 'install-1',
      authorizationMode: 'authenticated-direct',
      currentVersion: 1,
      resumeExpiresAt: Date.now() + 60_000
    })
    const pairing = { getEndpoints: vi.fn(), provisionRelay }

    await expect(
      dispatchPairing(
        'pairing.provisionRelay',
        { reqId: 'install-1', newResumeTokenHash: 'A'.repeat(43) },
        { pairing }
      )
    ).resolves.toMatchObject({ ok: true })
    expect(provisionRelay).toHaveBeenCalledWith({
      reqId: 'install-1',
      newResumeTokenHash: 'A'.repeat(43)
    })
  })

  it('rejects caller-selected identity and authorization metadata', async () => {
    const pairing = { getEndpoints: vi.fn(), provisionRelay: vi.fn() }

    for (const injected of [
      { relayDeviceId: 'attacker-device' },
      { authorization: { mode: 'relay-basis', basisConnId: 'attacker-basis' } },
      { directAuthId: 'attacker-direct' },
      { acceptedCredentialVersion: 99 }
    ]) {
      await expect(
        dispatchPairing(
          'pairing.provisionRelay',
          { reqId: 'install-1', newResumeTokenHash: 'A'.repeat(43), ...injected },
          { pairing }
        )
      ).resolves.toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    }
    await expect(
      dispatchPairing(
        'pairing.getEndpoints',
        { installReqId: 'status-1', basisConnId: 'injected' },
        { pairing }
      )
    ).resolves.toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    expect(pairing.provisionRelay).not.toHaveBeenCalled()
    expect(pairing.getEndpoints).not.toHaveBeenCalled()
  })

  it('forwards owner mobile-offer params to the desktop hook', async () => {
    const create = vi.fn().mockResolvedValue({
      available: true,
      pairingUrl: 'orca://pair#test-sentinel-mobile-offer',
      endpoint: 'ws://192.168.1.24:6768',
      deviceId: 'device-1',
      connectionMode: 'automatic'
    })

    await expect(
      dispatchPairing(
        'pairing.createMobileOffer',
        { address: '192.168.1.24', rotate: true },
        { mobilePairingOffers: { create } }
      )
    ).resolves.toMatchObject({
      ok: true,
      result: { available: true, deviceId: 'device-1', endpoint: 'ws://192.168.1.24:6768' }
    })
    expect(create).toHaveBeenCalledWith({ address: '192.168.1.24', rotate: true })
  })

  it('rejects unknown keys, empty addresses, and non-boolean rotate', async () => {
    const create = vi.fn()
    const options = { mobilePairingOffers: { create } }

    await expect(
      dispatchPairing('pairing.createMobileOffer', { deviceId: 'attacker' }, options)
    ).resolves.toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    await expect(
      dispatchPairing('pairing.createMobileOffer', { address: '   ' }, options)
    ).resolves.toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    await expect(
      dispatchPairing('pairing.createMobileOffer', { rotate: 'true' }, options)
    ).resolves.toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    expect(create).not.toHaveBeenCalled()
  })

  it('returns a stable error when the desktop hook is missing', async () => {
    await expect(dispatchPairing('pairing.createMobileOffer', {})).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'mobile_pairing_offer_unavailable',
        message: expect.stringMatching(/local desktop/)
      }
    })
  })
})
