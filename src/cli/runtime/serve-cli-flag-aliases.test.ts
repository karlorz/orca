import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseArgs, validateCommandAndFlags } from '../args'
import { COMMAND_SPECS } from '../specs'
import { SERVE_COMMAND_SPECS } from '../specs/serve'
import { getOptionalServePort } from './serve-port-flag'
import { applyLegacyServeCliFlagAliases, LEGACY_SERVE_CLI_FLAGS } from './serve-cli-flag-aliases'
import { RuntimeClient } from '../runtime-client'
import type * as RuntimeClientModule from '../runtime-client'

const serveOrcaAppMock = vi.hoisted(() => vi.fn(async () => 0))

vi.mock('../runtime-client', async (importOriginal) => {
  const actual = await importOriginal<typeof RuntimeClientModule>()
  return { ...actual, serveOrcaApp: serveOrcaAppMock }
})

import { CORE_HANDLERS } from '../handlers/core'

function parseServe(argv: string[]) {
  const parsed = parseArgs(argv, undefined, COMMAND_SPECS)
  expect(() => validateCommandAndFlags(COMMAND_SPECS, parsed)).not.toThrow()
  return parsed
}

describe('applyLegacyServeCliFlagAliases', () => {
  it('copies --serve-* names onto today’s flags without overwriting them', () => {
    const flags = applyLegacyServeCliFlagAliases(
      new Map<string, string | boolean>([
        ['serve', true],
        ['serve-port', '6768'],
        ['serve-pairing-address', 'wss://host.example'],
        ['serve-mobile-pairing', true],
        ['serve-json', true]
      ])
    )
    expect(flags.get('port')).toBe('6768')
    expect(flags.get('pairing-address')).toBe('wss://host.example')
    expect(flags.get('mobile-pairing')).toBe(true)
    expect(flags.get('json')).toBe(true)
    expect(flags.get('serve')).toBe(true)
  })

  it('leaves an explicit modern flag in place', () => {
    const flags = applyLegacyServeCliFlagAliases(
      new Map<string, string | boolean>([
        ['port', '6770'],
        ['serve-port', '6768']
      ])
    )
    expect(flags.get('port')).toBe('6770')
  })
})

describe('legacy --serve-* flags on the live serve spec and handler', () => {
  const savedExitCode = process.exitCode

  afterEach(() => {
    serveOrcaAppMock.mockReset()
    process.exitCode = savedExitCode
  })

  it('lists leftover --serve-* names on the serve spec', () => {
    const serveSpec = SERVE_COMMAND_SPECS.find((spec) => spec.path.join(' ') === 'serve')
    expect(serveSpec?.allowedFlags).toEqual(expect.arrayContaining([...LEGACY_SERVE_CLI_FLAGS]))
  })

  it('maps --serve-port, --serve-pairing-address, and --serve-mobile-pairing onto today’s names when they are absent', async () => {
    const parsed = parseServe([
      'serve',
      '--serve',
      '--serve-port',
      '6768',
      '--serve-pairing-address',
      'wss://host.example',
      '--serve-mobile-pairing',
      '--serve-json'
    ])
    applyLegacyServeCliFlagAliases(parsed.flags)
    expect(getOptionalServePort(parsed.flags)).toBe('6768')
    expect(parsed.flags.get('pairing-address')).toBe('wss://host.example')
    expect(parsed.flags.get('mobile-pairing')).toBe(true)
    expect(parsed.flags.get('json')).toBe(true)

    serveOrcaAppMock.mockResolvedValue(0)
    await CORE_HANDLERS.serve({
      flags: parseServe([
        'serve',
        '--serve-port',
        '6768',
        '--serve-pairing-address',
        'wss://host.example',
        '--serve-mobile-pairing',
        '--serve-json'
      ]).flags,
      client: new RuntimeClient(),
      cwd: process.cwd(),
      json: false
    })
    expect(serveOrcaAppMock).toHaveBeenCalledWith(
      expect.objectContaining({
        json: true,
        port: '6768',
        pairingAddress: 'wss://host.example',
        mobilePairing: true
      })
    )
  })

  it('lets an explicit modern --port win over --serve-port on the live handler', async () => {
    serveOrcaAppMock.mockResolvedValue(0)
    await CORE_HANDLERS.serve({
      flags: parseServe(['serve', '--port', '6770', '--serve-port', '6768']).flags,
      client: new RuntimeClient(),
      cwd: process.cwd(),
      json: false
    })
    expect(serveOrcaAppMock).toHaveBeenCalledWith(
      expect.objectContaining({
        port: '6770'
      })
    )
  })
})
