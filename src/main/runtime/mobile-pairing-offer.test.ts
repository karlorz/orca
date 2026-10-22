import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as NodeOs from 'node:os'

const networkInterfacesMock = vi.hoisted(() => vi.fn())

vi.mock('os', async (importOriginal) => ({
  ...(await importOriginal<typeof NodeOs>()),
  networkInterfaces: networkInterfacesMock
}))

import {
  createDesktopMobilePairingOffer,
  registerDesktopMobilePairingOffers
} from './mobile-pairing-offer'
import type { MobilePairingOffer } from './runtime-rpc/runtime-rpc-pairing-types'

const SENTINEL = 'orca://pair#test-sentinel-mobile-offer'

function availableOffer(overrides: Partial<Extract<MobilePairingOffer, { available: true }>> = {}) {
  return {
    available: true as const,
    pairingUrl: SENTINEL,
    endpoint: 'ws://127.0.0.1:6768',
    deviceId: 'device-1',
    webClientUrl: 'http://127.0.0.1:6768/web-index.html#pairing=secret',
    connectionMode: 'automatic' as const,
    ...overrides
  }
}

describe('createDesktopMobilePairingOffer', () => {
  beforeEach(() => {
    networkInterfacesMock.mockReset()
    networkInterfacesMock.mockReturnValue({})
  })

  it('forwards an explicit address and rotate to the factory', async () => {
    const createOffer = vi
      .fn()
      .mockResolvedValue(
        availableOffer({ endpoint: 'ws://192.168.1.24:6768', connectionMode: 'automatic' })
      )

    await expect(
      createDesktopMobilePairingOffer({
        createOffer,
        getListenerHost: () => '127.0.0.1',
        address: '192.168.1.24',
        rotate: true
      })
    ).resolves.toEqual({
      available: true,
      pairingUrl: SENTINEL,
      endpoint: 'ws://192.168.1.24:6768',
      deviceId: 'device-1',
      connectionMode: 'automatic'
    })
    expect(createOffer).toHaveBeenCalledWith(
      expect.objectContaining({ address: '192.168.1.24', rotate: true })
    )
  })

  it('refuses local-only pairing when no address can be advertised', async () => {
    const createOffer = vi.fn()

    await expect(
      createDesktopMobilePairingOffer({
        createOffer,
        getListenerHost: () => '127.0.0.1',
        connectionMode: 'local-only',
        getDefaultRouteInterfaceNames: async () => new Set()
      })
    ).resolves.toMatchObject({
      available: false,
      reason: 'invalid_advertised_endpoint'
    })
    expect(createOffer).not.toHaveBeenCalled()
  })

  it('returns a null endpoint when automatic pairing has no advertised interface', async () => {
    const createOffer = vi.fn().mockResolvedValue(availableOffer())

    await expect(
      createDesktopMobilePairingOffer({
        createOffer,
        getListenerHost: () => '127.0.0.1',
        getDefaultRouteInterfaceNames: async () => new Set()
      })
    ).resolves.toEqual({
      available: true,
      pairingUrl: SENTINEL,
      endpoint: null,
      deviceId: 'device-1',
      connectionMode: 'automatic'
    })
    expect(createOffer).toHaveBeenCalledWith(expect.objectContaining({ address: null }))
  })

  it('preserves typed factory unavailability including relayFailure', async () => {
    const createOffer = vi.fn().mockResolvedValue({
      available: false,
      reason: 'relay_mint_failed',
      guidance: 'Relay could not mint this offer.',
      relayFailure: { code: 'relay_offline', stage: 'provider_missing', message: 'offline' }
    })

    await expect(
      createDesktopMobilePairingOffer({
        createOffer,
        getListenerHost: () => '127.0.0.1',
        address: '100.64.1.20'
      })
    ).resolves.toEqual({
      available: false,
      reason: 'relay_mint_failed',
      guidance: 'Relay could not mint this offer.',
      relayFailure: { code: 'relay_offline', stage: 'provider_missing', message: 'offline' }
    })
  })
})

describe('registerDesktopMobilePairingOffers', () => {
  it('installs the owner hook only for desktop startup', () => {
    const createMobilePairingOffer = vi.fn()
    const setMobilePairingOffers = vi.fn()
    const rpcServer = {
      createMobilePairingOffer,
      setMobilePairingOffers,
      getNetworkExposureBindHost: () => '127.0.0.1'
    }

    registerDesktopMobilePairingOffers(rpcServer, { wsPort: 6768 })
    expect(setMobilePairingOffers).not.toHaveBeenCalled()

    registerDesktopMobilePairingOffers(rpcServer, null)
    expect(setMobilePairingOffers).toHaveBeenCalledTimes(1)
    expect(setMobilePairingOffers.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ create: expect.any(Function) })
    )
  })
})
