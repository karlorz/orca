import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  closeProviderTimelineRigs,
  SESSION
} from '../native-chat/agent-session-timeline/provider-timeline-assembler-test-support'
import { openAcpAdapterRig, PROVIDER_SESSION } from './acp-structured-adapter.test-support'

afterEach(closeProviderTimelineRigs)
const body = {
  kind: 'message',
  role: 'user',
  blocks: [{ type: 'text', text: 'fixture follow-up' }]
} as const

describe('Grok ACP bound control at the actual prompt and cancel writes', () => {
  it('discovers only an already-acquired native child, without a start', async () => {
    const rig = await openAcpAdapterRig()
    expect(rig.adapter.controlBinding(SESSION)).toBeNull()
    expect(rig.spawned).toEqual([])
    const acquired = await rig.acquire()
    expect(rig.adapter.controlBinding(SESSION)).toMatchObject({
      nativeSessionId: PROVIDER_SESSION,
      acquisitionGeneration: acquired.acquisitionGeneration,
      turnId: null,
      promptPending: false,
      canFollowUp: true
    })
    expect(rig.sent('session/new')).toHaveLength(1)
    rig.adapter.controlBinding(SESSION)
    expect(rig.sent('session/new')).toHaveLength(1)
  })

  it('guards after awaited preparation and synchronously before the idle prompt write', async () => {
    const rig = await openAcpAdapterRig()
    await rig.acquire()
    const order: string[] = []
    await rig.adapter.dispatch({
      sessionId: SESSION,
      clientMessageId: 'strict-1',
      body: { ...body, blocks: [...body.blocks] },
      fence: 1,
      beforeDispatch: async () => {
        await Promise.resolve()
        order.push('prepared')
      },
      beforePromptWrite: () => {
        expect(rig.sent('session/prompt')).toHaveLength(0)
        order.push('prompt-write')
      }
    })
    await rig.frame('session/prompt')
    expect(order).toEqual(['prepared', 'prompt-write'])
    expect(rig.sent('session/prompt')[0]?.params).toMatchObject({ sessionId: PROVIDER_SESSION })
  })

  it('never cancels or queues strict Follow up during a managed prompt, including the await race', async () => {
    const rig = await openAcpAdapterRig()
    await rig.acquire()
    await rig.adapter.dispatch({
      sessionId: SESSION,
      clientMessageId: 'first',
      body: { ...body, blocks: [...body.blocks] },
      fence: 1
    })
    const first = await rig.frame('session/prompt')
    expect(rig.adapter.controlBinding(SESSION)).toMatchObject({ canFollowUp: false })
    const guard = vi.fn()
    await rig.adapter.dispatch({
      sessionId: SESSION,
      clientMessageId: 'strict-active',
      body: { ...body, blocks: [...body.blocks] },
      fence: 1,
      beforeDispatch: async () => {
        await Promise.resolve()
      },
      beforePromptWrite: guard
    })
    expect(rig.sent('session/cancel')).toHaveLength(0)
    expect(rig.sent('session/prompt')).toHaveLength(1)
    expect(rig.settled).toContainEqual(
      expect.objectContaining({ clientMessageId: 'strict-active', state: 'rejected' })
    )
    rig.child().agent.reply(first, { stopReason: 'end_turn' })
    await rig.settle()
    expect(rig.sent('session/prompt')).toHaveLength(1)
    expect(guard).not.toHaveBeenCalled()
  })

  it('refuses a changed target at the prompt-write hook without sending a prompt', async () => {
    const rig = await openAcpAdapterRig()
    await rig.acquire()
    await rig.adapter.dispatch({
      sessionId: SESSION,
      clientMessageId: 'stale',
      body: { ...body, blocks: [...body.blocks] },
      fence: 1,
      beforePromptWrite: () => {
        throw new Error('target changed after preparation')
      }
    })
    await rig.settle()
    expect(rig.sent('session/prompt')).toHaveLength(0)
    expect(rig.sent('session/cancel')).toHaveLength(0)
    expect(rig.settled).toContainEqual(
      expect.objectContaining({ clientMessageId: 'stale', state: 'rejected' })
    )
  })

  it('runs the exact Stop guard immediately before ACP cancellation', async () => {
    const rig = await openAcpAdapterRig()
    await rig.acquire()
    await rig.adapter.dispatch({
      sessionId: SESSION,
      clientMessageId: 'running',
      body: { ...body, blocks: [...body.blocks] },
      fence: 1
    })
    await rig.frame('session/prompt')
    await expect(
      rig.adapter.cancelTurn({
        sessionId: SESSION,
        fence: 1,
        beforeCancel: () => {
          throw new Error('stale native/fence/child/turn')
        }
      })
    ).rejects.toThrow('stale')
    expect(rig.sent('session/cancel')).toHaveLength(0)
    expect(
      await rig.adapter.cancelTurn({
        sessionId: SESSION,
        fence: 1,
        beforeCancel: () => {
          expect(rig.sent('session/cancel')).toHaveLength(0)
        }
      })
    ).toEqual({ cancelled: true })
    await rig.settle()
    expect(rig.sent('session/cancel')).toHaveLength(1)
  })
})
