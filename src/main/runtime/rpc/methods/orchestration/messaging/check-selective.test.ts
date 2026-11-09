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

  function insertHistoryDelivery(
    id: string,
    messageIds: string[],
    status: 'acknowledged' | 'fenced',
    acknowledgedAt: string | null = null
  ): void {
    db.db
      .prepare(
        `INSERT INTO deliveries (
           id, run_id, mailbox_handle, consumer_generation, message_ids, status, created_at, acknowledged_at
         ) VALUES (?, ?, ?, 0, ?, ?, datetime('now'), ?)`
      )
      .run(id, runId(), `run:${runId()}`, JSON.stringify(messageIds), status, acknowledgedAt)
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
    expect(readTarget.fence).toBe(db.getRunMailboxFence(runId()))
    expect(db.getMessageById(second.id)?.read).toBe(0)
  })

  it('treats an acknowledged-history target as a no-op with no fence bump', async () => {
    setup()
    const target = insert('acked')
    const run = db.getRun(runId())
    const delivery = db.getOrCreateRunDelivery({
      runId: runId(),
      consumerGeneration: run?.consumer_generation ?? 0
    })
    if (!delivery) {
      throw new Error('Expected a Delivery')
    }
    db.acknowledgeRunDelivery({
      runId: runId(),
      consumerGeneration: run?.consumer_generation ?? 0,
      deliveryId: delivery.delivery.id
    })
    const fenceBefore = db.getRunMailboxFence(runId())

    const result = (await call('orchestration.check', {
      terminal: 'term_coord',
      selective: true,
      messageId: target.id
    })) as SelectiveConsumeResult

    expect(result.target_accept_count).toBe(0)
    expect(result.unrelated_mutation_count).toBe(0)
    expect(result.fence).toBe(fenceBefore)
    expect(result.after).toEqual(result.before)
    expect(result.before).toEqual([
      {
        delivery_id: delivery.delivery.id,
        message_ids: [target.id],
        read: [1],
        acknowledged: true
      }
    ])
    expect(db.getMessageById(target.id)?.read).toBe(1)
  })

  it('treats a read target in fenced history as a no-op', async () => {
    setup()
    const target = insert('fenced-read')
    const run = db.getRun(runId())
    const delivery = db.getOrCreateRunDelivery({
      runId: runId(),
      consumerGeneration: run?.consumer_generation ?? 0
    })
    if (!delivery) {
      throw new Error('Expected a Delivery')
    }
    db.markAsRead([target.id])
    db.fenceUnacknowledgedMailboxDeliveries(`run:${runId()}`)
    const fenceBefore = db.getRunMailboxFence(runId())

    const result = (await call('orchestration.check', {
      terminal: 'term_coord',
      selective: true,
      messageId: target.id
    })) as SelectiveConsumeResult

    expect(result.target_accept_count).toBe(0)
    expect(result.fence).toBe(fenceBefore)
    expect(result.after).toEqual(result.before)
    expect(result.before).toEqual([
      {
        delivery_id: delivery.delivery.id,
        message_ids: [target.id],
        read: [1],
        acknowledged: false
      }
    ])
  })

  it('consumes an unread target held only by fenced history', async () => {
    setup()
    const target = insert('fenced-unread')
    const run = db.getRun(runId())
    const delivery = db.getOrCreateRunDelivery({
      runId: runId(),
      consumerGeneration: run?.consumer_generation ?? 0
    })
    if (!delivery) {
      throw new Error('Expected a Delivery')
    }
    db.fenceUnacknowledgedMailboxDeliveries(`run:${runId()}`)
    const fenceBefore = db.getRunMailboxFence(runId())

    const result = (await call('orchestration.check', {
      terminal: 'term_coord',
      selective: true,
      messageId: target.id
    })) as SelectiveConsumeResult

    expect(result.target_accept_count).toBe(1)
    expect(result.unrelated_mutation_count).toBe(0)
    expect(result.fence).toBe(fenceBefore + 1)
    expect(result.after).toEqual([
      {
        delivery_id: delivery.delivery.id,
        message_ids: [target.id],
        read: [1],
        acknowledged: false
      }
    ])
    expect(db.getMessageById(target.id)?.read).toBe(1)
  })

  it('is a no-op for an already-read target with duplicate historical memberships', async () => {
    setup()
    const target = insert('duplicate-read')
    db.markAsRead([target.id])
    insertHistoryDelivery('delivery_hist_a', [target.id], 'acknowledged', '2026-01-01 00:00:00')
    insertHistoryDelivery('delivery_hist_b', [target.id], 'fenced')
    const fenceBefore = db.getRunMailboxFence(runId())

    const result = (await call('orchestration.check', {
      terminal: 'term_coord',
      selective: true,
      messageId: target.id
    })) as SelectiveConsumeResult

    expect(result.target_accept_count).toBe(0)
    expect(result.fence).toBe(fenceBefore)
    expect(result.after).toEqual(result.before)
    expect(result.before).toHaveLength(2)
    expect(result.before.every((entry) => entry.read[0] === 1)).toBe(true)
  })

  it('marks an unread target read across duplicate historical memberships', async () => {
    setup()
    const target = insert('duplicate-unread')
    insertHistoryDelivery('delivery_hist_c', [target.id], 'acknowledged', '2026-01-01 00:00:00')
    insertHistoryDelivery('delivery_hist_d', [target.id], 'fenced')
    const fenceBefore = db.getRunMailboxFence(runId())

    const result = (await call('orchestration.check', {
      terminal: 'term_coord',
      selective: true,
      messageId: target.id
    })) as SelectiveConsumeResult

    expect(result.target_accept_count).toBe(1)
    expect(result.unrelated_mutation_count).toBe(0)
    expect(result.fence).toBe(fenceBefore + 1)
    expect(result.before.map((entry) => entry.read)).toEqual([[0], [0]])
    expect(result.after.map((entry) => entry.read)).toEqual([[1], [1]])
    expect(db.getMessageById(target.id)?.read).toBe(1)
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

  it('consumes an unread target in a multi-message fenced Delivery while the peer stays unread', async () => {
    setup()
    const target = insert('target-multi-fenced')
    const peer = insert('peer-multi-fenced')
    insertHistoryDelivery('delivery_hist_multi_fenced', [target.id, peer.id], 'fenced')
    const fenceBefore = db.getRunMailboxFence(runId())

    const result = (await call('orchestration.check', {
      terminal: 'term_coord',
      selective: true,
      messageId: target.id
    })) as SelectiveConsumeResult

    expect(result.target_accept_count).toBe(1)
    expect(result.unrelated_mutation_count).toBe(0)
    expect(result.fence).toBe(fenceBefore + 1)
    expect(result.before).toEqual([
      {
        delivery_id: 'delivery_hist_multi_fenced',
        message_ids: [target.id, peer.id],
        read: [0, 0],
        acknowledged: false
      }
    ])
    expect(result.after).toEqual([
      {
        delivery_id: 'delivery_hist_multi_fenced',
        message_ids: [target.id, peer.id],
        read: [1, 0],
        acknowledged: false
      }
    ])
    expect(db.getMessageById(target.id)?.read).toBe(1)
    expect(db.getMessageById(peer.id)?.read).toBe(0)
  })

  it('consumes an unread target in a multi-message fenced Delivery when the peer is already read', async () => {
    setup()
    const target = insert('target-multi-peer-read')
    const peer = insert('peer-multi-peer-read')
    db.markAsRead([peer.id])
    insertHistoryDelivery('delivery_hist_multi_peer_read', [target.id, peer.id], 'fenced')
    const fenceBefore = db.getRunMailboxFence(runId())

    const result = (await call('orchestration.check', {
      terminal: 'term_coord',
      selective: true,
      messageId: target.id
    })) as SelectiveConsumeResult

    expect(result.target_accept_count).toBe(1)
    expect(result.unrelated_mutation_count).toBe(0)
    expect(result.fence).toBe(fenceBefore + 1)
    expect(result.before).toEqual([
      {
        delivery_id: 'delivery_hist_multi_peer_read',
        message_ids: [target.id, peer.id],
        read: [0, 1],
        acknowledged: false
      }
    ])
    expect(result.after).toEqual([
      {
        delivery_id: 'delivery_hist_multi_peer_read',
        message_ids: [target.id, peer.id],
        read: [1, 1],
        acknowledged: false
      }
    ])
    expect(db.getMessageById(target.id)?.read).toBe(1)
    expect(db.getMessageById(peer.id)?.read).toBe(1)
  })

  it('consumes an unread target spanning multiple historical Deliveries with mixed memberships', async () => {
    setup()
    const target = insert('target-mixed')
    const peerA = insert('peer-mixed-a')
    const peerB = insert('peer-mixed-b')
    insertHistoryDelivery(
      'delivery_hist_mixed_1',
      [target.id, peerA.id],
      'acknowledged',
      '2026-01-01 00:00:00'
    )
    insertHistoryDelivery('delivery_hist_mixed_2', [peerB.id, target.id], 'fenced')
    const fenceBefore = db.getRunMailboxFence(runId())

    const result = (await call('orchestration.check', {
      terminal: 'term_coord',
      selective: true,
      messageId: target.id
    })) as SelectiveConsumeResult

    expect(result.target_accept_count).toBe(1)
    expect(result.unrelated_mutation_count).toBe(0)
    expect(result.fence).toBe(fenceBefore + 1)
    expect(result.before).toEqual([
      {
        delivery_id: 'delivery_hist_mixed_1',
        message_ids: [target.id, peerA.id],
        read: [0, 0],
        acknowledged: true
      },
      {
        delivery_id: 'delivery_hist_mixed_2',
        message_ids: [peerB.id, target.id],
        read: [0, 0],
        acknowledged: false
      }
    ])
    expect(result.after).toEqual([
      {
        delivery_id: 'delivery_hist_mixed_1',
        message_ids: [target.id, peerA.id],
        read: [1, 0],
        acknowledged: true
      },
      {
        delivery_id: 'delivery_hist_mixed_2',
        message_ids: [peerB.id, target.id],
        read: [0, 1],
        acknowledged: false
      }
    ])
    expect(db.getMessageById(target.id)?.read).toBe(1)
    expect(db.getMessageById(peerA.id)?.read).toBe(0)
    expect(db.getMessageById(peerB.id)?.read).toBe(0)
  })

  it('treats a repeated consume of a multi-message fenced Delivery as count0 with no fence bump', async () => {
    setup()
    const target = insert('target-repeat')
    const peer = insert('peer-repeat')
    insertHistoryDelivery('delivery_hist_repeat', [target.id, peer.id], 'fenced')

    const first = (await call('orchestration.check', {
      terminal: 'term_coord',
      selective: true,
      messageId: target.id
    })) as SelectiveConsumeResult
    expect(first.target_accept_count).toBe(1)

    const second = (await call('orchestration.check', {
      terminal: 'term_coord',
      selective: true,
      messageId: target.id
    })) as SelectiveConsumeResult

    expect(second.target_accept_count).toBe(0)
    expect(second.unrelated_mutation_count).toBe(0)
    expect(second.fence).toBe(first.fence)
    expect(second.after).toEqual(second.before)
    expect(second.before).toEqual([
      {
        delivery_id: 'delivery_hist_repeat',
        message_ids: [target.id, peer.id],
        read: [1, 0],
        acknowledged: false
      }
    ])
    expect(db.getMessageById(target.id)?.read).toBe(1)
    expect(db.getMessageById(peer.id)?.read).toBe(0)
  })

  it('rolls back when a trigger marks a shared-entry peer read during consume', async () => {
    setup()
    const target = insert('target-trigger-peer')
    const peer = insert('peer-trigger-peer')
    insertHistoryDelivery('delivery_hist_trigger_peer', [target.id, peer.id], 'fenced')
    const fenceBefore = db.getRunMailboxFence(runId())

    db.db.exec(`
      CREATE TEMP TRIGGER mutate_peer_on_target_read
      AFTER UPDATE OF read ON messages
      WHEN NEW.id = '${target.id}' AND NEW.read = 1
      BEGIN
        UPDATE messages SET read = 1 WHERE id = '${peer.id}';
      END;
    `)

    await expect(
      call('orchestration.check', {
        terminal: 'term_coord',
        selective: true,
        messageId: target.id
      })
    ).rejects.toMatchObject({
      code: 'selective_consume_verification_failed',
      data: { unrelated_mutation_count: 1 }
    })

    expect(db.getMessageById(target.id)?.read).toBe(0)
    expect(db.getMessageById(peer.id)?.read).toBe(0)
    expect(db.getRunMailboxFence(runId())).toBe(fenceBefore)
  })

  it('rolls back when a trigger mutates Delivery metadata during consume', async () => {
    setup()
    const target = insert('target-trigger-meta')
    const peer = insert('peer-trigger-meta')
    insertHistoryDelivery('delivery_hist_trigger_meta', [target.id, peer.id], 'fenced')
    const fenceBefore = db.getRunMailboxFence(runId())

    db.db.exec(`
      CREATE TEMP TRIGGER mutate_delivery_status_on_target_read
      AFTER UPDATE OF read ON messages
      WHEN NEW.id = '${target.id}' AND NEW.read = 1
      BEGIN
        UPDATE deliveries SET status = 'acknowledged' WHERE id = 'delivery_hist_trigger_meta';
      END;
    `)

    await expect(
      call('orchestration.check', {
        terminal: 'term_coord',
        selective: true,
        messageId: target.id
      })
    ).rejects.toMatchObject({
      code: 'selective_consume_verification_failed',
      data: { unrelated_mutation_count: 1 }
    })

    expect(db.getMessageById(target.id)?.read).toBe(0)
    expect(db.getMessageById(peer.id)?.read).toBe(0)
    expect(db.getRunMailboxFence(runId())).toBe(fenceBefore)
    const delivery = db.db
      .prepare('SELECT status FROM deliveries WHERE id = ?')
      .get('delivery_hist_trigger_meta') as { status: string }
    expect(delivery.status).toBe('fenced')
  })
})
