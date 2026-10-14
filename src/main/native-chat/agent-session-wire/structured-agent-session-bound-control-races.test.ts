import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BOUND_CALLER,
  boundSend,
  boundStop,
  openBoundControlRig
} from './structured-agent-session-bound-control.test-fixture'

let rig: Awaited<ReturnType<typeof openBoundControlRig>>
beforeEach(async () => {
  rig = await openBoundControlRig()
})
afterEach(async () => {
  await rig.dispose()
})

describe('bound control currentness at awaited provider boundaries', () => {
  it('refuses discovery when its unique native match moves before the serialized read', async () => {
    const records = rig.store.listRecords()
    const listed = vi
      .spyOn(rig.store, 'listRecords')
      .mockReturnValueOnce(records)
      .mockReturnValueOnce([{ ...records[0], sessionId: 'another-session' }])
    try {
      expect(
        await rig.host.controlTarget({ provider: 'grok', nativeSessionId: 'native-grok-1' })
      ).toMatchObject({ supported: false })
      expect(rig.acquire).toHaveBeenCalledOnce()
    } finally {
      listed.mockRestore()
    }
  })

  it('refuses a Stop revision changed after its own bookkeeping, without child wind-down', async () => {
    await rig.turn('turn-1')
    const params = boundStop(await rig.target())
    let cancelled = false
    rig.cancelTurn.mockImplementationOnce(async (input) => {
      await Promise.resolve()
      rig.state.nativeSessionId = 'native-grok-moved'
      input.beforeCancel?.()
      cancelled = true
      return { cancelled: true }
    })
    expect(await rig.host.cancel(BOUND_CALLER, params)).toMatchObject({
      ok: false,
      refusal: { code: 'agent_session_operation_unknown' }
    })
    expect(cancelled).toBe(false)
    expect(rig.state.live).toBe(true)
    expect(rig.session.child?.close).toBeUndefined()
    expect(rig.acquire).toHaveBeenCalledOnce()
  })

  it('refuses a Follow up revision changed after acceptance but before the prompt write', async () => {
    const params = boundSend(await rig.target())
    let wrotePrompt = false
    rig.dispatch.mockImplementationOnce(async (input) => {
      await input.beforeDispatch?.()
      await rig.session.journal.appendItem(
        {
          provider: 'legacy',
          agent: 'grok',
          sessionId: 'native-grok-1',
          recordId: 'revision-race'
        },
        { kind: 'status', text: 'new provider state' },
        { fence: 1, turnScope: AGENT_JOURNAL_THREAD_SCOPE }
      )
      input.beforePromptWrite?.()
      wrotePrompt = true
      return { state: 'admitted' }
    })
    expect(await rig.host.send(BOUND_CALLER, params)).toMatchObject({
      ok: true,
      value: { controlReceipt: { state: 'unconfirmed' } }
    })
    expect(wrotePrompt).toBe(false)
    expect(rig.cancelTurn).not.toHaveBeenCalled()
    expect(rig.acquire).toHaveBeenCalledOnce()
  })
})
