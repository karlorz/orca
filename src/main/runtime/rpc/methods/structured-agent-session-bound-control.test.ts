import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AGENT_SESSION_BOUND_CONTROL_CAPABILITY } from '../../../../shared/agent-session-bound-control'
import { RUNTIME_CAPABILITIES } from '../../../../shared/protocol-version'
import {
  call,
  clearStructuredHostStub,
  hostCalls,
  installStructuredHostStub,
  sendParams
} from './structured-agent-session-rpc.test-fixture'

beforeEach(() => {
  installStructuredHostStub()
  hostCalls.controlTarget = vi.fn(async () => ({ supported: false, reason: 'unresolvable' }))
})
afterEach(clearStructuredHostStub)

const target = {
  executionHostId: 'local',
  runtimeId: 'runtime-1',
  sessionId: 'session-alpha',
  provider: 'grok',
  nativeSessionId: 'native-1',
  turnId: null,
  runtimeFence: 1,
  acquisitionGeneration: 'child-1',
  revision: 1,
  token: 'opaque'
} as const

describe('bound control RPC capability and strict field boundary', () => {
  it('refuses a client without the complete negotiated capability before touching the host', async () => {
    const response = await call(
      'agentSession.controlTarget',
      { provider: 'grok', nativeSessionId: 'native-1' },
      {
        clientKind: 'runtime',
        clientCapabilities: RUNTIME_CAPABILITIES.filter(
          (c) => c !== AGENT_SESSION_BOUND_CONTROL_CAPABILITY
        )
      }
    )
    expect(response).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('structured_agent_session_unsupported') }
    })
    expect(hostCalls.controlTarget).not.toHaveBeenCalled()
  })

  it('rejects strict send and Stop from old peers while keeping legacy send available', async () => {
    const client = {
      clientKind: 'runtime' as const,
      clientCapabilities: RUNTIME_CAPABILITIES.filter(
        (c) => c !== AGENT_SESSION_BOUND_CONTROL_CAPABILITY
      )
    }
    expect(
      await call('agentSession.send', sendParams({ expectedControlTarget: target }), client)
    ).toMatchObject({ ok: false })
    expect(
      await call(
        'agentSession.cancel',
        { envelope: sendParams().envelope, expectedControlTarget: target },
        client
      )
    ).toMatchObject({ ok: false })
    expect(hostCalls.send).not.toHaveBeenCalled()
    expect(hostCalls.cancel).not.toHaveBeenCalled()
    expect(await call('agentSession.send', sendParams(), client)).toMatchObject({ ok: true })
    expect(hostCalls.send).toHaveBeenCalledOnce()
  })

  it('rejects malformed targets and provider-controlled discovery input', async () => {
    expect(
      await call('agentSession.controlTarget', { provider: 'codex', nativeSessionId: 'n' })
    ).toMatchObject({ ok: false })
    expect(
      await call(
        'agentSession.send',
        sendParams({ expectedControlTarget: { ...target, extra: true } })
      )
    ).toMatchObject({ ok: false })
    expect(hostCalls.send).not.toHaveBeenCalled()
  })
})
