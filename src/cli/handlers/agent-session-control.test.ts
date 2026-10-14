import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AGENT_SESSION_CONTROL_HANDLERS } from './agent-session-control'
import { AGENT_SESSION_BOUND_CONTROL_CAPABILITY } from '../../shared/agent-session-bound-control'
import {
  STRUCTURED_AGENT_SESSION_REGISTERED_AGENTS_RUNTIME_CAPABILITY,
  STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY
} from '../../shared/protocol-version'
import { RuntimeClient } from '../runtime-client'

vi.mock('../runtime-client', () => ({
  RuntimeClient: class {
    call(...args: unknown[]) {
      return call(...args)
    }
    getCliStatus() {
      return getCliStatus()
    }
  }
}))
vi.mock('../format', () => ({ printResult: vi.fn() }))
const call = vi.fn()
const getCliStatus = vi.fn()
const capabilities = [
  AGENT_SESSION_BOUND_CONTROL_CAPABILITY,
  STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY,
  STRUCTURED_AGENT_SESSION_REGISTERED_AGENTS_RUNTIME_CAPABILITY
]
beforeEach(() => {
  call.mockReset().mockResolvedValue({
    id: 'rpc',
    ok: true,
    result: { supported: false, reason: 'unresolvable' },
    _meta: { runtimeId: 'remote' }
  })
  getCliStatus.mockReset().mockResolvedValue({ result: { runtime: { capabilities } } })
})

describe('bound control CLI host negotiation', () => {
  it('routes only to the selected runtime and preserves discovery params', async () => {
    const client = new RuntimeClient()
    await AGENT_SESSION_CONTROL_HANDLERS['agent-session control-target']({
      client,
      cwd: '/folder',
      json: true,
      flags: new Map([
        ['request', JSON.stringify({ provider: 'grok', nativeSessionId: 'harvested' })]
      ])
    })
    expect(getCliStatus).toHaveBeenCalledOnce()
    expect(call).toHaveBeenCalledExactlyOnceWith('agentSession.controlTarget', {
      provider: 'grok',
      nativeSessionId: 'harvested'
    })
  })

  it.each([undefined, [], [AGENT_SESSION_BOUND_CONTROL_CAPABILITY]])(
    'fails closed for old or incomplete host capability %j',
    async (caps) => {
      getCliStatus.mockResolvedValueOnce({ result: { runtime: { capabilities: caps } } })
      await expect(
        AGENT_SESSION_CONTROL_HANDLERS['agent-session control-target']({
          client: new RuntimeClient(),
          cwd: '/folder',
          json: true,
          flags: new Map([['request', '{"provider":"grok","nativeSessionId":"harvested"}']])
        })
      ).rejects.toThrow('does not support')
      expect(call).not.toHaveBeenCalled()
    }
  )
})
