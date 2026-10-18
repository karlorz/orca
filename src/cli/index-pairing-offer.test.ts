import { describe, expect, it, vi } from 'vitest'

const {
  callMock,
  runtimeClientConstructorMock,
  serveOrcaAppMock,
  getDefaultUserDataPathMock,
  addEnvironmentFromPairingCodeMock,
  listEnvironmentsMock,
  spawnMock
} = vi.hoisted(() => ({
  callMock: vi.fn(),
  runtimeClientConstructorMock: vi.fn(),
  serveOrcaAppMock: vi.fn(),
  getDefaultUserDataPathMock: vi.fn(() => '/tmp/orca-user-data'),
  addEnvironmentFromPairingCodeMock: vi.fn(),
  listEnvironmentsMock: vi.fn(),
  spawnMock: vi.fn()
}))

vi.mock('./runtime-client', async () => {
  const { createRuntimeClientModuleMock } = await import('./index-test-harness.js')
  return createRuntimeClientModuleMock({
    callMock,
    runtimeClientConstructorMock,
    serveOrcaAppMock,
    getDefaultUserDataPathMock
  })
})

vi.mock('./runtime/environments', () => ({
  addEnvironmentFromPairingCode: addEnvironmentFromPairingCodeMock,
  listEnvironments: listEnvironmentsMock,
  removeEnvironment: vi.fn(),
  resolveEnvironment: vi.fn()
}))

vi.mock('child_process', async () => {
  const { createChildProcessModuleMock } = await import('./index-test-harness.js')
  return createChildProcessModuleMock(spawnMock)
})

import { main } from './index'
import { okFixture } from './test-fixtures'
import { pairRuntimeEnvironment, useWorktreeAwarenessEnvironment } from './index-test-harness'

const SENTINEL = 'orca://pair#test-sentinel-mobile-offer'

function availableOffer() {
  return okFixture('req_pairing_offer', {
    available: true,
    pairingUrl: SENTINEL,
    endpoint: 'ws://192.168.1.24:6768',
    deviceId: 'device-1',
    connectionMode: 'automatic'
  })
}

describe('orca pairing offer', () => {
  useWorktreeAwarenessEnvironment({
    callMock,
    serveOrcaAppMock,
    getDefaultUserDataPathMock,
    addEnvironmentFromPairingCodeMock,
    listEnvironmentsMock,
    spawnMock
  })

  it('requires --scope mobile before talking to the runtime', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await main(['pairing', 'offer', '--json'], '/tmp/repo')

    const printed = JSON.parse(String(logSpy.mock.calls[0]?.[0]))
    expect(printed.ok).toBe(false)
    expect(printed.error.code).toBe('invalid_argument')
    expect(printed.error.message).toMatch(/--scope mobile/)
    expect(callMock).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
    process.exitCode = 0
  })

  it('rejects an unknown scope before any RPC', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await main(['pairing', 'offer', '--scope', 'runtime', '--json'], '/tmp/repo')

    const printed = JSON.parse(String(logSpy.mock.calls[0]?.[0]))
    expect(printed.ok).toBe(false)
    expect(printed.error.message).toMatch(/Unknown --scope runtime/)
    expect(callMock).not.toHaveBeenCalled()
    process.exitCode = 0
  })

  it('rejects an empty pairing address before any RPC', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await main(
      ['pairing', 'offer', '--scope', 'mobile', '--pairing-address', '', '--json'],
      '/tmp/repo'
    )

    const printed = JSON.parse(String(logSpy.mock.calls[0]?.[0]))
    expect(printed.ok).toBe(false)
    expect(printed.error.message).toMatch(/--pairing-address/)
    expect(callMock).not.toHaveBeenCalled()
    process.exitCode = 0
  })

  it.each([
    ['before', ['--rotate', 'pairing', 'offer', '--scope', 'mobile', '--json']],
    ['between', ['pairing', '--rotate', 'offer', '--scope', 'mobile', '--json']],
    ['after', ['pairing', 'offer', '--rotate', '--scope', 'mobile', '--json']]
  ])('parses --rotate %s command words', async (_where, argv) => {
    callMock.mockResolvedValue(availableOffer())
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await main(argv, '/tmp/repo')

    expect(callMock).toHaveBeenCalledWith('pairing.createMobileOffer', { rotate: true })
    expect(JSON.parse(String(logSpy.mock.calls[0]?.[0])).result.pairingUrl).toBe(SENTINEL)
    expect(runtimeClientConstructorMock).toHaveBeenCalledWith(null, null)
  })

  it('mints locally and keeps the sentinel credential out of diagnostic stderr', async () => {
    callMock.mockResolvedValue(availableOffer())
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await main(
      ['pairing', 'offer', '--scope', 'mobile', '--pairing-address', '192.168.1.24', '--json'],
      '/tmp/repo'
    )

    const printed = JSON.parse(String(logSpy.mock.calls[0]?.[0]))
    expect(printed.ok).toBe(true)
    expect(printed.result.pairingUrl).toBe(SENTINEL)
    expect(callMock).toHaveBeenCalledWith('pairing.createMobileOffer', {
      address: '192.168.1.24'
    })
    expect(errorSpy.mock.calls.flat().join(' ')).not.toContain(SENTINEL)
    expect(runtimeClientConstructorMock).toHaveBeenCalledWith(null, null)
  })

  it('suppresses ambient remote selectors so the offer stays on this desktop', async () => {
    process.env.ORCA_ENVIRONMENT = 'pvelxc'
    process.env.ORCA_PAIRING_CODE = 'orca://pair#ambient'
    process.env.ORCA_REMOTE_PAIRING = 'orca://pair#legacy'
    callMock.mockResolvedValue(availableOffer())
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await main(['pairing', 'offer', '--scope', 'mobile', '--json'], '/tmp/repo')

    expect(runtimeClientConstructorMock).toHaveBeenCalledWith(null, null)
    delete process.env.ORCA_ENVIRONMENT
    delete process.env.ORCA_PAIRING_CODE
    delete process.env.ORCA_REMOTE_PAIRING
  })

  it('refuses explicit remote selectors before any RPC', async () => {
    pairRuntimeEnvironment(listEnvironmentsMock, 'env-pvelxc', 'pvelxc')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await main(
      ['pairing', 'offer', '--scope', 'mobile', '--environment', 'pvelxc', '--json'],
      '/tmp/repo'
    )

    const printed = JSON.parse(String(logSpy.mock.calls[0]?.[0]))
    expect(printed.ok).toBe(false)
    expect(printed.error.code).toBe('invalid_argument')
    expect(printed.error.message).toMatch(/--environment/)
    expect(callMock).not.toHaveBeenCalled()
    process.exitCode = 0
  })

  it('rejects --host instead of minting elsewhere', async () => {
    pairRuntimeEnvironment(listEnvironmentsMock, 'env-pvelxc', 'pvelxc')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await main(
      ['pairing', 'offer', '--scope', 'mobile', '--host', 'runtime:env-pvelxc', '--json'],
      '/tmp/repo'
    )

    const printed = JSON.parse(String(logSpy.mock.calls[0]?.[0]))
    expect(printed.ok).toBe(false)
    expect(printed.error.message).toMatch(/Unknown flag --host/)
    expect(callMock).not.toHaveBeenCalled()
    process.exitCode = 0
  })

  it('turns an unknown local method into desktop-update guidance', async () => {
    const { RuntimeRpcFailureError } = await import('./runtime/types.js')
    callMock.mockRejectedValue(
      new RuntimeRpcFailureError({
        id: 'req',
        ok: false,
        error: { code: 'method_not_found', message: 'Unknown method: pairing.createMobileOffer' },
        _meta: { runtimeId: 'runtime-1' }
      })
    )
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await main(['pairing', 'offer', '--scope', 'mobile', '--json'], '/tmp/repo')

    const printed = JSON.parse(String(logSpy.mock.calls[0]?.[0]))
    expect(printed.ok).toBe(false)
    expect(printed.error.code).toBe('incompatible_runtime')
    expect(printed.error.message).toMatch(/Update the local desktop/)
    process.exitCode = 0
  })

  it('exits nonzero for an unavailable offer without a success URL', async () => {
    callMock.mockResolvedValue(
      okFixture('req_pairing_offer', {
        available: false,
        reason: 'relay_mint_failed',
        guidance: 'Relay could not mint this offer.'
      })
    )
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await main(['pairing', 'offer', '--scope', 'mobile', '--json'], '/tmp/repo')

    const printed = JSON.parse(String(logSpy.mock.calls[0]?.[0]))
    expect(printed.ok).toBe(false)
    expect(printed.error.code).toBe('relay_mint_failed')
    expect(printed.error.message).toMatch(/Relay could not mint/)
    expect(JSON.stringify(printed)).not.toContain(SENTINEL)
    expect(process.exitCode).toBe(1)
    process.exitCode = 0
  })
})
