import { describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { RpcDispatcher } from '../dispatcher'
import { TERMINAL_METHODS } from './terminal'

function fixture() {
  const switchOriginatingPane = vi
    .fn()
    .mockResolvedValue({ provider: 'grok', sessionId: 's', navigated: true })
  const runtime = { getRuntimeId: () => 'runtime', switchOriginatingPane }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: This method only reads runtime identity and invokes the mocked originating-pane method.
  const dispatcher = new RpcDispatcher({
    runtime: runtime as unknown as OrcaRuntimeService,
    methods: TERMINAL_METHODS
  })
  return { dispatcher, switchOriginatingPane }
}
function request(params: unknown) {
  return { id: 'req', authToken: 'token', method: 'terminal.switchOrigin', params }
}

describe('originating-pane RPC authority', () => {
  it('rejects paired callers without the capability before invoking focus', async () => {
    const { dispatcher, switchOriginatingPane } = fixture()
    const response = await dispatcher.dispatch(
      request({ provider: 'grok', session: 's', navigation: 'host' }),
      {
        clientKind: 'runtime',
        clientCapabilities: []
      }
    )
    expect(response).toMatchObject({
      ok: false,
      error: { message: 'session_navigation_unavailable' }
    })
    expect(switchOriginatingPane).not.toHaveBeenCalled()
  })
  it('uses the guarded runtime path with exact original identity', async () => {
    const { dispatcher, switchOriginatingPane } = fixture()
    const response = await dispatcher.dispatch(
      request({ provider: 'grok', session: 's', workspace: '/work', navigation: 'host' })
    )
    expect(response).toMatchObject({ ok: true, result: { navigation: { navigated: true } } })
    expect(switchOriginatingPane).toHaveBeenCalledExactlyOnceWith(
      { provider: 'grok', session: 's', workspace: '/work' },
      { activateHostWindow: true }
    )
  })
  it('requires explicit host navigation for paired callers', async () => {
    const { dispatcher, switchOriginatingPane } = fixture()
    const response = await dispatcher.dispatch(request({ provider: 'grok', session: 's' }), {
      clientKind: 'runtime'
    })
    expect(response).toMatchObject({ ok: false })
    expect(switchOriginatingPane).not.toHaveBeenCalled()
  })
  it('selects for paired callers without raising the host window', async () => {
    const { dispatcher, switchOriginatingPane } = fixture()
    await dispatcher.dispatch(request({ provider: 'grok', session: 's', navigation: 'host' }), {
      clientKind: 'runtime',
      clientCapabilities: ['terminal.originating-pane-navigation.v1']
    })
    expect(switchOriginatingPane).toHaveBeenCalledExactlyOnceWith(
      { provider: 'grok', session: 's' },
      { activateHostWindow: false }
    )
  })
  it.each([
    { provider: 'other', session: 's' },
    { provider: 'grok', session: '' },
    { provider: 'grok', session: 's\0' },
    { provider: 'grok', session: 's', workspace: '' },
    { provider: 'grok', session: 's', navigation: 'clients' }
  ])('rejects malformed input without reveal: %j', async (params) => {
    const { dispatcher, switchOriginatingPane } = fixture()
    expect(await dispatcher.dispatch(request(params))).toMatchObject({
      ok: false,
      error: { code: 'invalid_argument' }
    })
    expect(switchOriginatingPane).not.toHaveBeenCalled()
  })
  it('propagates a stale origin without weaker focus', async () => {
    const { dispatcher, switchOriginatingPane } = fixture()
    switchOriginatingPane.mockRejectedValueOnce(new Error('session_binding_changed'))
    expect(await dispatcher.dispatch(request({ provider: 'grok', session: 's' }))).toMatchObject({
      ok: false
    })
    expect(switchOriginatingPane).toHaveBeenCalledTimes(1)
  })
})
