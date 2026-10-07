import { describe, expect, it, vi } from 'vitest'
import { terminalSwitchOriginHandler } from './terminal-originating-pane'
import type { HandlerContext } from '../dispatch'
import { TERMINAL_ORIGINATING_PANE_NAVIGATION_RUNTIME_CAPABILITY } from '../../shared/protocol-version'
import { CORE_COMMAND_SPECS } from '../specs/core'
import { parseArgs, validateCommandAndFlags } from '../args'

vi.mock('../format', () => ({ printResult: vi.fn() }))

function fixture(
  capabilities: string[] = [TERMINAL_ORIGINATING_PANE_NAVIGATION_RUNTIME_CAPABILITY]
) {
  const call = vi.fn(async () => ({ ok: true, result: { navigation: { navigated: true } } }))
  const getCliStatus = vi.fn(async () => ({ result: { runtime: { capabilities } } }))
  const context = {
    flags: new Map<string, string | boolean>([
      ['provider', 'grok'],
      ['session', 'session-1']
    ]),
    client: { call, getCliStatus },
    json: true,
    cwd: '/workspace'
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Only the mocked client methods and flags are read by this handler.
  return { context: context as unknown as HandlerContext, call, getCliStatus }
}

describe('originating-pane CLI', () => {
  it('registers the exact command and flags', () => {
    const parsed = parseArgs([
      'terminal',
      'switch-origin',
      '--provider',
      'grok',
      '--session',
      's',
      '--workspace',
      '/work',
      '--json'
    ])
    expect(() => validateCommandAndFlags(CORE_COMMAND_SPECS, parsed)).not.toThrow()
  })
  it.each(['grok', 'codex', 'claude', 'cursor'])(
    'sends exact %s identity and workspace',
    async (provider) => {
      const { context, call } = fixture()
      context.flags.set('provider', provider)
      context.flags.set('workspace', '/work/My Project')
      await terminalSwitchOriginHandler(context)
      expect(call).toHaveBeenCalledExactlyOnceWith('terminal.switchOrigin', {
        provider,
        session: 'session-1',
        workspace: '/work/My Project',
        navigation: 'host'
      })
    }
  )
  it('refuses old hosts without invoking any focus method', async () => {
    const { context, call } = fixture([])
    await expect(terminalSwitchOriginHandler(context)).rejects.toMatchObject({
      code: 'session_navigation_unavailable'
    })
    expect(call).not.toHaveBeenCalled()
  })
  it.each(['other', 'grok\0'])(
    'rejects unsupported provider %s before contacting the host',
    async (provider) => {
      const { context, call, getCliStatus } = fixture()
      context.flags.set('provider', provider)
      await expect(terminalSwitchOriginHandler(context)).rejects.toMatchObject({
        code: 'invalid_argument'
      })
      expect(call).not.toHaveBeenCalled()
      expect(getCliStatus).not.toHaveBeenCalled()
    }
  )
  it('propagates identity refusals without fallback', async () => {
    const { context, call } = fixture()
    call.mockRejectedValueOnce(new Error('session_binding_ambiguous'))
    await expect(terminalSwitchOriginHandler(context)).rejects.toThrow('session_binding_ambiguous')
    expect(call).toHaveBeenCalledTimes(1)
  })
})
