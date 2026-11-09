import { OrchestrationError } from '../../orchestration-error'
import type { OrchestrationDb } from '../orchestration-db'
import { requireMailboxConsumer } from './mailbox-consumer'

export type MailboxSnapshotEntry = {
  delivery_id: string | null
  message_ids: string[]
  read: number[]
  acknowledged: boolean
}

export type SelectiveConsumeResult = {
  target_accept_count: number
  unrelated_mutation_count: number
  before: MailboxSnapshotEntry[]
  after: MailboxSnapshotEntry[]
  fence: number
}

type SnapshotDeliveryRow = { id: string; message_ids: string; status: string }
type SnapshotMessageRow = { id: string; read: number; sequence: number }

function readFlagsFor(db: OrchestrationDb, ids: string[]): Map<string, number> {
  if (ids.length === 0) {
    return new Map()
  }
  const rows = db.db
    .prepare(`SELECT id, read FROM messages WHERE id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids) as { id: string; read: number }[]
  return new Map(rows.map((row) => [row.id, row.read]))
}

/** Ordered held state: every Delivery (read/ack flags) plus unread mail outside any Delivery. */
export function getRunMailboxSnapshot(
  this: OrchestrationDb,
  runId: string,
  carriedMessageIds: readonly string[] = []
): MailboxSnapshotEntry[] {
  const mailboxHandle = `run:${runId}`
  const deliveries = this.db
    .prepare(
      'SELECT id, message_ids, status FROM deliveries WHERE mailbox_handle = ? ORDER BY rowid'
    )
    .all(mailboxHandle) as SnapshotDeliveryRow[]
  const entries: MailboxSnapshotEntry[] = []
  const deliveredIds = new Set<string>()
  for (const delivery of deliveries) {
    const messageIds = JSON.parse(delivery.message_ids) as string[]
    if (messageIds.length === 0) {
      continue
    }
    for (const id of messageIds) {
      deliveredIds.add(id)
    }
    const flags = readFlagsFor(this, messageIds)
    entries.push({
      delivery_id: delivery.id,
      message_ids: messageIds,
      read: messageIds.map((id) => flags.get(id) ?? 0),
      acknowledged: delivery.status === 'acknowledged'
    })
  }
  const standalone = new Map<string, SnapshotMessageRow>()
  const unread = this.db
    .prepare(
      `SELECT id, read, sequence FROM messages
       WHERE run_id = ? AND to_handle = ? AND read = 0
         AND delivery_contract = 'current_delivery'
       ORDER BY sequence`
    )
    .all(runId, mailboxHandle) as SnapshotMessageRow[]
  for (const row of unread) {
    if (!deliveredIds.has(row.id)) {
      standalone.set(row.id, row)
    }
  }
  // A just-consumed target keeps its entry so `after` differs only at the target.
  if (carriedMessageIds.length > 0) {
    const placeholders = carriedMessageIds.map(() => '?').join(',')
    const carried = this.db
      .prepare(
        `SELECT id, read, sequence FROM messages
         WHERE id IN (${placeholders}) AND run_id = ? AND to_handle = ?`
      )
      .all(...carriedMessageIds, runId, mailboxHandle) as SnapshotMessageRow[]
    for (const row of carried) {
      if (!deliveredIds.has(row.id)) {
        standalone.set(row.id, row)
      }
    }
  }
  for (const row of [...standalone.values()].sort((a, b) => a.sequence - b.sequence)) {
    entries.push({
      delivery_id: null,
      message_ids: [row.id],
      read: [row.read],
      acknowledged: false
    })
  }
  return entries
}

/** The target only counts while it is currently unread in this exact Run mailbox. */
function readRunMailboxTarget(
  db: OrchestrationDb,
  runId: string,
  messageId: string
): { read: number } | undefined {
  return db.db
    .prepare(
      `SELECT read FROM messages
       WHERE id = ? AND run_id = ? AND to_handle = ?
         AND delivery_contract = 'current_delivery'`
    )
    .get(messageId, runId, `run:${runId}`) as { read: number } | undefined
}

function countUnrelatedMutations(
  before: MailboxSnapshotEntry[],
  after: MailboxSnapshotEntry[],
  targetMessageId: string
): number {
  const others = (entries: MailboxSnapshotEntry[]) =>
    entries.filter((entry) => !entry.message_ids.includes(targetMessageId))
  const beforeOthers = others(before)
  const afterOthers = others(after)
  let count = Math.abs(beforeOthers.length - afterOthers.length)
  for (let index = 0; index < Math.min(beforeOthers.length, afterOthers.length); index += 1) {
    if (JSON.stringify(beforeOthers[index]) !== JSON.stringify(afterOthers[index])) {
      count += 1
    }
  }
  return count
}

/** Mark exactly one Run-mailbox message read inside one BEGIN IMMEDIATE, proving nothing else moved. */
export function selectiveConsumeMailboxDelivery(
  this: OrchestrationDb,
  params: { runId: string; consumerGeneration: number; messageId: string }
): SelectiveConsumeResult {
  const mailboxHandle = `run:${params.runId}`
  this.db.exec('BEGIN IMMEDIATE')
  try {
    requireMailboxConsumer(this, {
      runId: params.runId,
      mailboxHandle,
      consumerGeneration: params.consumerGeneration
    })
    const before = this.getRunMailboxSnapshot(params.runId)
    const fenceBefore = this.getRunMailboxFence(params.runId)
    const targetRow = readRunMailboxTarget(this, params.runId, params.messageId)
    // Already read (standalone, acknowledged history, fenced history) is a no-op, never acceptance.
    if (!targetRow || targetRow.read !== 0) {
      this.db.exec('COMMIT')
      return {
        target_accept_count: 0,
        unrelated_mutation_count: 0,
        before,
        after: before,
        fence: fenceBefore
      }
    }
    const targetEntries = before.filter((entry) => entry.message_ids.includes(params.messageId))
    if (targetEntries.length === 0) {
      throw new OrchestrationError(
        'selective_consume_verification_failed',
        'The unread target is missing from the mailbox snapshot; the transaction was rolled back.',
        { before }
      )
    }
    for (const entry of targetEntries) {
      if (entry.delivery_id === null) {
        continue
      }
      const delivery = this.getDeliveryRaw(entry.delivery_id)
      if (delivery?.status === 'outstanding') {
        throw new OrchestrationError(
          'outstanding_delivery_conflict',
          `Message ${params.messageId} is held by outstanding Delivery ${delivery.id}. Acknowledge that whole batch instead of selectively consuming it.`,
          { delivery_id: delivery.id, message_id: params.messageId }
        )
      }
    }
    this.markAsRead([params.messageId])
    const after = this.getRunMailboxSnapshot(params.runId, [params.messageId])
    const fence = this.getRunMailboxFence(params.runId)
    const afterTargetEntries = after.filter((entry) =>
      entry.message_ids.includes(params.messageId)
    )
    if (
      afterTargetEntries.length === 0 ||
      !afterTargetEntries.every((entry) => entry.read.every((flag) => flag === 1))
    ) {
      throw new OrchestrationError(
        'selective_consume_verification_failed',
        'Selective consume did not observe the target read transition; the transaction was rolled back.',
        { before, after }
      )
    }
    const unrelatedMutationCount = countUnrelatedMutations(before, after, params.messageId)
    if (unrelatedMutationCount > 0) {
      throw new OrchestrationError(
        'selective_consume_verification_failed',
        'Selective consume changed unrelated mailbox state; the transaction was rolled back.',
        { unrelated_mutation_count: unrelatedMutationCount, before, after }
      )
    }
    this.db.exec('COMMIT')
    return {
      target_accept_count: 1,
      unrelated_mutation_count: 0,
      before,
      after,
      fence
    }
  } catch (error) {
    this.db.exec('ROLLBACK')
    throw error
  }
}

export type RunMailboxSelectiveConsumeMethods = {
  getRunMailboxSnapshot: typeof getRunMailboxSnapshot
  selectiveConsumeMailboxDelivery: typeof selectiveConsumeMailboxDelivery
}

export function attachRunMailboxSelectiveConsume(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    getRunMailboxSnapshot,
    selectiveConsumeMailboxDelivery
  })
}
