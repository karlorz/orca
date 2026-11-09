import { afterEach, describe, expect, it } from 'vitest'
import type { RpcContext } from '../../../core'
import { createOrchestrationRpcHarness } from '../rpc-test-harness'
import type { OrchestrationDb } from '../../../../orchestration/db'
import type { MailboxSnapshotEntry } from '../../../../orchestration/db/messages/run-mailbox-selective-consume'

type SelectiveConsumeResult = {
  target_accept_count: number
  unrelated_mutation_count: number
  before: MailboxSnapshotEntry[]
  after: MailboxSnapshotEntry[]
  fence: number
}

describe('orchestration check --selective and mailbox fence', () => {
  const h = createOrchestrationRpcHarness()
  let db: OrchestrationDb
  let ctx: RpcContext
  let activeRunId: string | undefined

  function setup(withBoundRun = true): void {
    ;({ db, ctx, activeRunId } = h.setup(withBoundRun))
  }

  afterEach(() => {
    h.cleanup()
  })

  async function call(name: string, params: Record<string, unknown>) {
    return h.call(name, params, ctx)
  }

  function insert(subject: string) {
    return db.insertMessage({
      from: 'worker',
      to: `run:${activeRunId}`,
      subject,
      runId: activeRunId
    })
  }

  function runId(): string {
    if (!activeRunId) {
      throw new Error('Expected a bound Run')
    }
    return activeRunId
  }

  it('marks exactly the target read and reports an unchanged snapshot otherwise', async () => {
    setup()
    const target = insert('target')
    const other = insert('other')
    const fenceBefore = db.getRunMailboxFence(runId())

    const result = (await call('orchestration.check', {
      terminal: 'term_coord',
      selective: true,
      messageId: target.id
    })) as SelectiveConsumeResult

    expect(result.target_accept_count).toBe(1)
    expect(result.unrelated_mutation_count).toBe(0)
    expect(result.fence).toBe(fenceBefore + 1)
    expect(db.getMessageById(target.id)?.read).toBe(1)
    expect(db.getMessageById(other.id)?.read).toBe(0)

    expect(result.before).toEqual([
      { delivery_id: null, message_ids: [target.id], read: [0], acknowledged: false },
      { delivery_id: null, message_ids: [other.id], read: [0], acknowledged: false }
    ])
    expect(result.after).toEqual([
      { delivery_id: null, message_ids: [target.id], read: [1], acknowledged: false },
      { delivery_id: null, message_ids: [other.id], read: [0], acknowledged: false }
    ])
    expect(Object.keys(result).sort()).toEqual([
      'after',
      'before',
      'fence',
      'target_accept_count',
      'unrelated_mutation_count'
    ])
    for (const entry of result.before) {
      expect(Object.keys(entry).sort()).toEqual([
        'acknowledged',
        'delivery_id',
        'message_ids',
        'read'
      ])
    }
  })

  it('returns count 0 with byte-identical snapshots when the target is not unread', async () => {
    setup()
    const first = insert('first')
    const second = insert('second')
    const fenceBefore = db.getRunMailboxFence(runId())

    const missing = (await call('orchestration.check', {
      terminal: 'term_coord',
      selective: true,
      messageId: 'msg_not_in_mailbox'
    })) as SelectiveConsumeResult

    expect(missing.target_accept_count).toBe(0)
    expect(missing.unrelated_mutation_count).toBe(0)
    expect(missing.fence).toBe(fenceBefore)
    expect(missing.after).toEqual(missing.before)
    expect(db.getMessageById(first.id)?.read).toBe(0)
    expect(db.getMessageById(second.id)?.read).toBe(0)

    db.markAsRead([first.id])
    const readTarget = (await call('orchestration.check', {
      terminal: 'term_coord',
      selective: true,
      messageId: first.id
    })) as SelectiveConsumeResult
    expect(readTarget.target_accept_count).toBe(0)
    expect(readTarget.after).toEqual(readTarget.before)
    expect(db.getMessageById(second.id)?.read).toBe(0)
  })

  it('fails closed without mutation when the target sits in an outstanding Delivery', async () => {
    setup()
    const target = insert('target')
    const other = insert('other')
    const run = db.getRun(runId())
    const delivery = db.getOrCreateRunDelivery({
      runId: runId(),
      consumerGeneration: run?.consumer_generation ?? 0
    })
    if (!delivery) {
      throw new Error('Expected a Delivery')
    }
    const fenceBefore = db.getRunMailboxFence(runId())

    await expect(
      call('orchestration.check', {
        terminal: 'term_coord',
        selective: true,
        messageId: target.id
      })
    ).rejects.toMatchObject({
      code: 'outstanding_delivery_conflict',
      data: { delivery_id: delivery.delivery.id, message_id: target.id }
    })
    expect(db.getMessageById(target.id)?.read).toBe(0)
    expect(db.getMessageById(other.id)?.read).toBe(0)
    expect(db.getRunMailboxFence(runId())).toBe(fenceBefore)
  })

  it('refuses a stale --expect-fence before any mutation', async () => {
    setup()
    const first = insert('first')
    const second = insert('second')
    const fenceBefore = db.getRunMailboxFence(runId())

    const matched = (await call('orchestration.check', {
      terminal: 'term_coord',
      peek: true,
      expectFence: fenceBefore
    })) as { count: number; fence: number }
    expect(matched.count).toBe(2)
    expect(matched.fence).toBe(fenceBefore)

    await expect(
      call('orchestration.check', {
        terminal: 'term_coord',
        expectFence: fenceBefore + 1
      })
    ).rejects.toMatchObject({
      code: 'fence_stale',
      data: { expected_fence: fenceBefore + 1, actual_fence: fenceBefore }
    })
    expect(db.hasOutstandingRunDelivery(runId())).toBe(false)
    expect(db.getRunMailboxFence(runId())).toBe(fenceBefore)
    expect(db.getMessageById(first.id)?.read).toBe(0)
    expect(db.getMessageById(second.id)?.read).toBe(0)
  })

  it('bumps the fence inside message, Delivery-create and acknowledgment transactions', () => {
    setup()
    const start = db.getRunMailboxFence(runId())

    const message = insert('fenced')
    expect(db.getRunMailboxFence(runId())).toBe(start + 1)

    const run = db.getRun(runId())
    const delivery = db.getOrCreateRunDelivery({
      runId: runId(),
      consumerGeneration: run?.consumer_generation ?? 0
    })
    expect(db.getRunMailboxFence(runId())).toBe(start + 2)

    if (!delivery) {
      throw new Error('Expected a Delivery')
    }
    db.acknowledgeRunDelivery({
      runId: runId(),
      consumerGeneration: run?.consumer_generation ?? 0,
      deliveryId: delivery.delivery.id
    })
    expect(db.getRunMailboxFence(runId())).toBe(start + 3)
    expect(db.getMessageById(message.id)?.read).toBe(1)
  })

  it('rejects --selective outside the Run mailbox', async () => {
    setup(false)
    await expect(
      call('orchestration.check', {
        terminal: 'term_worker',
        selective: true,
        messageId: 'msg_any'
      })
    ).rejects.toMatchObject({ code: 'selective_unsupported' })
  })

  it('rejects --expect-fence on a direct mailbox', async () => {
    setup(false)
    await expect(
      call('orchestration.check', { terminal: 'term_worker', peek: true, expectFence: 0 })
    ).rejects.toMatchObject({ code: 'invalid_argument' })
  })
})
