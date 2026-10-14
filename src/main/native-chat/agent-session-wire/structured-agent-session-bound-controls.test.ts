import { StructuredAgentSessionHost } from './structured-agent-session-host'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BOUND_CALLER,
  BOUND_NATIVE,
  boundSend,
  boundStop,
  openBoundControlRig
} from './structured-agent-session-bound-control.test-fixture'
import { HOST_TEST_SESSION } from './structured-agent-session-host-test-data'
import { openTestAgentSessionRecordStore } from '../../runtime/agent-session-record-store-test-harness'

let rig: Awaited<ReturnType<typeof openBoundControlRig>>
beforeEach(async () => {
  rig = await openBoundControlRig()
})
afterEach(async () => {
  vi.useRealTimers()
  await rig.dispose()
})

describe('bound Grok controls over the real host, store and journal', () => {
  it('resolves an existing folder session without acquiring and dispatches exactly once', async () => {
    const target = await rig.target()
    expect(rig.acquire).toHaveBeenCalledOnce()
    const params = boundSend(target, 'literal $(touch /tmp/no) `echo no`\n你好 / 👋')
    const results = await Promise.all([
      rig.host.send(BOUND_CALLER, params),
      rig.host.send(BOUND_CALLER, params)
    ])
    expect(results).toEqual(expect.arrayContaining([expect.objectContaining({ replayed: true })]))
    for (const result of results) {
      expect(result).toMatchObject({
        ok: true,
        value: {
          controlReceipt: {
            target,
            clientOperationId: params.envelope.clientOperationId,
            state: 'delivered'
          }
        }
      })
    }
    expect(rig.dispatch).toHaveBeenCalledOnce()
    expect(rig.acquire).toHaveBeenCalledOnce()
  })

  it.each([
    'provider',
    'nativeSessionId',
    'turnId',
    'runtimeFence',
    'acquisitionGeneration',
    'revision',
    'runtimeId',
    'executionHostId',
    'token'
  ] as const)('atomically refuses a stale or forged %s', async (field) => {
    const current = await rig.target()
    const target = { ...current, [field]: typeof current[field] === 'number' ? 999 : 'other' }
    // A malformed provider is caught at the RPC boundary; exercise host currentness as well.
    const params = boundSend({ ...current, ...target })
    expect(await rig.host.send(BOUND_CALLER, params)).toMatchObject({ ok: false })
    expect(rig.dispatch).not.toHaveBeenCalled()
  })

  it('refuses a target that changes while waiting for the serialized mutation lane', async () => {
    const params = boundSend(await rig.target())
    let release: (() => void) | undefined
    const held = rig.host.collaboratorsForTests().serialize(
      HOST_TEST_SESSION,
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    )
    await vi.waitFor(() => expect(release).toBeDefined())
    const pending = rig.host.send(BOUND_CALLER, params)
    rig.state.generation = 'child-2'
    release?.()
    await held
    expect(await pending).toMatchObject({ ok: false })
    expect(rig.dispatch).not.toHaveBeenCalled()
  })

  it('revalidates after awaited provider preparation, leaves no queued send and never starts a child', async () => {
    const params = boundSend(await rig.target())
    rig.dispatch.mockImplementationOnce(async (input) => {
      await Promise.resolve()
      rig.state.generation = 'child-replaced'
      await input.beforeDispatch?.()
      throw new Error('a stale dispatch must not reach this line')
    })
    expect(await rig.host.send(BOUND_CALLER, params)).toMatchObject({
      ok: true,
      value: { controlReceipt: { state: 'unconfirmed' } }
    })
    expect(rig.session.journal.submissions()).toMatchObject([{ dispatchState: 'unknown' }])
    expect(await rig.host.send(BOUND_CALLER, params)).toMatchObject({
      ok: true,
      replayed: true,
      value: { controlReceipt: { state: 'unconfirmed' } }
    })
    expect(rig.dispatch).toHaveBeenCalledOnce()
    expect(rig.acquire).toHaveBeenCalledOnce()
  })

  it('replays durable receipt before freshness after child replacement and a store reload', async () => {
    const params = boundSend(await rig.target())
    await rig.host.send(BOUND_CALLER, params)
    rig.state.generation = 'replacement'
    rig.host.deps.store = await openTestAgentSessionRecordStore(rig.root)
    expect(await rig.host.send(BOUND_CALLER, params)).toMatchObject({
      ok: true,
      replayed: true,
      value: { controlReceipt: { state: 'delivered', target: params.expectedControlTarget } }
    })
    expect(rig.dispatch).toHaveBeenCalledOnce()
  })

  it('preserves durable replay across a fresh runtime while refusing its stale targets', async () => {
    const params = boundSend(await rig.target())
    await rig.host.send(BOUND_CALLER, params)
    await rig.host.flushAllStreamedEvents()
    const fresh = new StructuredAgentSessionHost({
      ...rig.host.deps,
      store: await openTestAgentSessionRecordStore(rig.root)
    })
    try {
      expect(await fresh.send(BOUND_CALLER, boundSend(params.expectedControlTarget))).toMatchObject(
        { ok: false }
      )
      expect(await fresh.send(BOUND_CALLER, params)).toMatchObject({
        ok: true,
        replayed: true,
        value: { controlReceipt: { state: 'delivered', target: params.expectedControlTarget } }
      })
      expect(rig.dispatch).toHaveBeenCalledOnce()
      expect(rig.acquire).toHaveBeenCalledOnce()
    } finally {
      await fresh.flushAllStreamedEvents()
    }
  })

  it('rejects operation fingerprint conflicts even after target replacement', async () => {
    const first = boundSend(await rig.target(), 'first')
    await rig.host.send(BOUND_CALLER, first)
    const changed = boundSend(first.expectedControlTarget, 'changed')
    changed.envelope.clientOperationId = first.envelope.clientOperationId
    rig.state.live = false
    expect(await rig.host.send(BOUND_CALLER, changed)).toMatchObject({
      ok: false,
      refusal: { code: 'agent_session_operation_conflict' }
    })
    expect(rig.dispatch).toHaveBeenCalledOnce()
  })

  it('refuses Follow up while an ACP question waits, including a just-arrived question', async () => {
    const params = boundSend(await rig.target())
    rig.state.promptPending = true
    expect(await rig.host.send(BOUND_CALLER, params)).toMatchObject({ ok: false })
    const resolved = await rig.host.controlTarget({
      provider: 'grok',
      nativeSessionId: BOUND_NATIVE
    })
    expect(resolved).toMatchObject({ supported: true, canFollowUp: false })
    if (!resolved.supported) {
      throw new Error('Expected readable waiting target')
    }
    expect(await rig.host.send(BOUND_CALLER, boundSend(resolved.target))).toMatchObject({
      ok: false,
      refusal: { details: { reason: 'promptPending' } }
    })
    expect(rig.dispatch).not.toHaveBeenCalled()
  })

  it('fails closed for native mismatch, absent provider, ambiguous binding and unresolved in-flight turn', async () => {
    rig.state.nativeSessionId = 'different-native'
    expect(
      await rig.host.controlTarget({ provider: 'grok', nativeSessionId: BOUND_NATIVE })
    ).toMatchObject({ supported: false, reason: 'nativeMismatch' })
    rig.state.nativeSessionId = BOUND_NATIVE
    rig.state.inFlight = true
    expect(
      await rig.host.controlTarget({ provider: 'grok', nativeSessionId: BOUND_NATIVE })
    ).toMatchObject({ supported: false, reason: 'inFlightUnresolved' })
    rig.state.inFlight = false
    const records = rig.store.listRecords()
    const duplicates = vi
      .spyOn(rig.store, 'listRecords')
      .mockReturnValue([...records, { ...records[0], sessionId: 'duplicate' }])
    expect(
      await rig.host.controlTarget({ provider: 'grok', nativeSessionId: BOUND_NATIVE })
    ).toMatchObject({ supported: false, reason: 'ambiguous' })
    duplicates.mockRestore()
    expect(
      await rig.host.controlTarget({ provider: 'grok', nativeSessionId: 'pty-only' })
    ).toMatchObject({ supported: false, reason: 'unresolvable' })
  })

  it('refuses active Follow up without a cancellation, queue or submission', async () => {
    await rig.turn('turn-active')
    const result = await rig.host.controlTarget({ provider: 'grok', nativeSessionId: BOUND_NATIVE })
    expect(result).toMatchObject({ supported: true, canFollowUp: false, canStop: true })
    if (!result.supported) {
      throw new Error('Expected active Stop target')
    }
    expect(await rig.host.send(BOUND_CALLER, boundSend(result.target))).toMatchObject({ ok: false })
    expect(rig.session.journal.submissions()).toEqual([])
    expect(rig.dispatch).not.toHaveBeenCalled()
    expect(rig.cancelTurn).not.toHaveBeenCalled()
  })

  it('does not promote cancellation return alone, bounds observation and never reissues unconfirmed Stop', async () => {
    await rig.turn('turn-1')
    const params = boundStop(await rig.target())
    rig.host.deps.adapter.closeSession = async () => false
    const call = rig.host.cancel(BOUND_CALLER, params)
    await vi.waitFor(() => expect(rig.cancelTurn).toHaveBeenCalledOnce())
    vi.useFakeTimers()
    await vi.advanceTimersByTimeAsync(5100)
    expect(await call).toMatchObject({
      ok: true,
      value: { controlReceipt: { state: 'unconfirmed' } }
    })
    vi.useRealTimers()
    expect(await rig.host.cancel(BOUND_CALLER, params)).toMatchObject({
      ok: true,
      replayed: true,
      value: { controlReceipt: { state: 'unconfirmed' } }
    })
    expect(rig.cancelTurn).toHaveBeenCalledOnce()
    rig.host.deps.adapter.closeSession = async () => {
      rig.state.live = false
      return true
    }
  })

  it('fails closed on reload and an at-rest provider without starting a child', async () => {
    const target = await rig.target()
    const child = rig.session.child
    rig.session.child = null
    expect(
      await rig.host.controlTarget({ provider: 'grok', nativeSessionId: BOUND_NATIVE })
    ).toMatchObject({ supported: false })
    rig.session.child = child
    expect(await rig.host.send(BOUND_CALLER, boundSend(target))).toMatchObject({ ok: false })
    expect(rig.acquire).toHaveBeenCalledOnce()
    expect(rig.dispatch).not.toHaveBeenCalled()
  })

  it('records idle Stop as notRunning with no cancellation, then replays it', async () => {
    const params = boundStop(await rig.target())
    expect(await rig.host.cancel(BOUND_CALLER, params)).toMatchObject({
      ok: true,
      value: { cancelled: false, controlReceipt: { state: 'notRunning' } }
    })
    rig.state.live = false
    expect(await rig.host.cancel(BOUND_CALLER, params)).toMatchObject({
      ok: true,
      replayed: true,
      value: { controlReceipt: { state: 'notRunning' } }
    })
    expect(rig.cancelTurn).not.toHaveBeenCalled()
  })

  it('requires observed matching turn end and replays the original Stop receipt', async () => {
    await rig.turn('turn-1')
    const params = boundStop(await rig.target())
    rig.host.deps.adapter.awaitStoppedRequestEnd = async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 30))
      await rig.turn('turn-1', true)
    }
    rig.cancelTurn.mockImplementationOnce(async (input) => {
      input.beforeCancel?.()
      return { cancelled: true }
    })
    expect(await rig.host.cancel(BOUND_CALLER, params)).toMatchObject({
      ok: true,
      value: { controlReceipt: { state: 'stopped', target: params.expectedControlTarget } }
    })
    rig.state.live = false
    expect(await rig.host.cancel(BOUND_CALLER, params)).toMatchObject({
      ok: true,
      replayed: true,
      value: { controlReceipt: { state: 'stopped' } }
    })
    expect(rig.cancelTurn).toHaveBeenCalledOnce()
  })

  it('rejects a stale exact turn and mismatched stop field without cancelling another turn', async () => {
    await rig.turn('turn-1')
    const target = await rig.target()
    await rig.turn('turn-1', true)
    await rig.turn('turn-2')
    expect(await rig.host.cancel(BOUND_CALLER, boundStop(target))).toMatchObject({ ok: false })
    expect(rig.cancelTurn).not.toHaveBeenCalled()
  })
})
