import '../unused-default-rpc-methods.test-fixture'
import { describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../orca-runtime'
import type { RpcRequest } from '../core'
import { RpcDispatcher } from '../dispatcher'
import { TERMINAL_METHODS } from './terminal'
import type {
  GrokSessionObservation,
  GrokSessionTerminalOwner
} from '../../../../shared/grok-session-binding'

const sessionOwner: GrokSessionTerminalOwner = {
  runtimeId: 'runtime-1',
  executionHostId: 'local',
  handle: 'term-session',
  ptyId: 'pty-session',
  incarnationId: 'inc-session',
  paneKey: 'tab-session:11111111-1111-4111-8111-111111111111',
  tabId: 'tab-session',
  leafId: '11111111-1111-4111-8111-111111111111',
  worktreeId: 'wt-session',
  launchToken: 'launch-session'
}
const sessionObservation: GrokSessionObservation = {
  owner: sessionOwner,
  sessionId: 'session-1',
  boundaryAt: 1,
  eventAt: 2,
  retiredSessionIds: []
}

vi.mock('../../../agent-hooks/server', () => ({
  agentHookServer: { getGrokSessionObservations: () => [sessionObservation] }
}))

function sessionRequest(method: string, params: unknown): RpcRequest {
  return { id: 'session-1', authToken: 'token', method, params }
}

function sessionRuntime() {
  return {
    getRuntimeId: () => 'runtime-1',
    getSessionTerminalOwner: vi.fn(() => sessionOwner),
    revealSessionTerminal: vi.fn().mockResolvedValue({
      identity: {
        ptyId: sessionOwner.ptyId,
        tabId: sessionOwner.tabId,
        leafId: sessionOwner.leafId,
        worktreeId: sessionOwner.worktreeId
      },
      navigated: true,
      windowFocused: false,
      paneFocused: false
    })
  } as unknown as OrcaRuntimeService
}

function request(params: unknown): RpcRequest {
  return {
    id: 'focus-1',
    authToken: 'token',
    method: 'terminal.focus',
    params
  }
}

describe('terminal focus navigation authority', () => {
  it('denies implicit paired focus while preserving local and explicit host focus', async () => {
    const runtime = {
      getRuntimeId: () => 'runtime-1',
      focusTerminal: vi.fn().mockResolvedValue({
        handle: 'term-1',
        tabId: 'tab-1',
        worktreeId: 'wt-1'
      })
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: TERMINAL_METHODS })

    await dispatcher.dispatchStreaming(request({ terminal: 'term-1' }), () => {}, {
      clientKind: 'mobile',
      pairedDeviceId: 'device-a'
    })
    await dispatcher.dispatchStreaming(
      request({ terminal: 'term-1', navigation: 'host' }),
      () => {},
      { clientKind: 'runtime', pairedDeviceId: 'device-b' }
    )
    await dispatcher.dispatchStreaming(request({ terminal: 'term-1' }), () => {}, {
      clientKind: 'runtime',
      pairedDeviceId: 'device-b'
    })
    await dispatcher.dispatch(request({ terminal: 'term-1' }))
    await dispatcher.dispatch(request({ terminal: 'term-1', navigation: 'host' }))

    expect(runtime.focusTerminal).toHaveBeenNthCalledWith(1, 'term-1', {
      navigateHost: false,
      activateHostWindow: false
    })
    expect(runtime.focusTerminal).toHaveBeenNthCalledWith(2, 'term-1', {
      navigateHost: true,
      activateHostWindow: false
    })
    expect(runtime.focusTerminal).toHaveBeenNthCalledWith(3, 'term-1', {
      navigateHost: false,
      activateHostWindow: false
    })
    expect(runtime.focusTerminal).toHaveBeenNthCalledWith(4, 'term-1', {
      navigateHost: true,
      activateHostWindow: true
    })
    // Why: the local CLI switch (`orca terminal switch --terminal <handle>`) is the exact caller
    // that may raise the host window; a paired caller asking for the same host navigation may not.
    expect(runtime.focusTerminal).toHaveBeenNthCalledWith(5, 'term-1', {
      navigateHost: true,
      activateHostWindow: true
    })
  })

  it('rejects client fanout targets that terminal focus cannot honor', async () => {
    const runtime = {
      getRuntimeId: () => 'runtime-1',
      focusTerminal: vi.fn()
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: TERMINAL_METHODS })

    const response = await dispatcher.dispatch(
      request({ terminal: 'term-1', navigation: 'clients' })
    )

    expect(response).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    expect(runtime.focusTerminal).not.toHaveBeenCalled()
  })
})

describe('terminal switch session host activation authority', () => {
  it('authorizes native activation for the execution-host CLI', async () => {
    const runtime = sessionRuntime()
    const dispatcher = new RpcDispatcher({ runtime, methods: TERMINAL_METHODS })

    const response = await dispatcher.dispatch(
      sessionRequest('terminal.switchSession', {
        provider: 'grok',
        session: 'session-1',
        navigation: 'host'
      })
    )

    expect(response).toMatchObject({ ok: true })
    expect(runtime.revealSessionTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-1' }),
      expect.any(Function),
      { activateHostWindow: true }
    )
  })

  it('navigates a paired caller that explicitly requests host navigation without native activation', async () => {
    const runtime = sessionRuntime()
    const dispatcher = new RpcDispatcher({ runtime, methods: TERMINAL_METHODS })

    const response = await dispatcher.dispatch(
      sessionRequest('terminal.switchSession', {
        provider: 'grok',
        session: 'session-1',
        navigation: 'host'
      }),
      { clientKind: 'mobile', pairedDeviceId: 'device-a' }
    )

    expect(response).toMatchObject({ ok: true })
    expect(runtime.revealSessionTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-1' }),
      expect.any(Function),
      { activateHostWindow: false }
    )
  })

  it('refuses a paired caller that does not request host navigation', async () => {
    const runtime = sessionRuntime()
    const dispatcher = new RpcDispatcher({ runtime, methods: TERMINAL_METHODS })

    const response = await dispatcher.dispatch(
      sessionRequest('terminal.switchSession', { provider: 'grok', session: 'session-1' }),
      { clientKind: 'mobile', pairedDeviceId: 'device-a' }
    )

    expect(response).toMatchObject({ ok: false })
    expect(runtime.revealSessionTerminal).not.toHaveBeenCalled()
  })
})
