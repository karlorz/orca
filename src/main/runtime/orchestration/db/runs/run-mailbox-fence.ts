import type { OrchestrationDb } from '../orchestration-db'

const FENCE_BATCH_SIZE = 500

/** Bump the Run's mailbox fence inside the caller's mailbox transaction. */
export function bumpRunMailboxFence(this: OrchestrationDb, runId: string): number {
  this.db.prepare('UPDATE runs SET mailbox_fence = mailbox_fence + 1 WHERE id = ?').run(runId)
  return this.getRunMailboxFence(runId)
}

/** Bump every Run owning one of these messages; call inside the mutation's transaction. */
export function bumpRunMailboxFencesForMessages(
  this: OrchestrationDb,
  messageIds: string[]
): void {
  for (let offset = 0; offset < messageIds.length; offset += FENCE_BATCH_SIZE) {
    const batch = messageIds.slice(offset, offset + FENCE_BATCH_SIZE)
    const placeholders = batch.map(() => '?').join(',')
    this.db
      .prepare(
        `UPDATE runs SET mailbox_fence = mailbox_fence + 1
         WHERE id IN (SELECT DISTINCT run_id FROM messages WHERE id IN (${placeholders}))`
      )
      .run(...batch)
  }
}

export function getRunMailboxFence(this: OrchestrationDb, runId: string): number {
  const row = this.db.prepare('SELECT mailbox_fence FROM runs WHERE id = ?').get(runId) as
    | { mailbox_fence: number }
    | undefined
  return row?.mailbox_fence ?? 0
}

export type RunMailboxFenceMethods = {
  bumpRunMailboxFence: typeof bumpRunMailboxFence
  bumpRunMailboxFencesForMessages: typeof bumpRunMailboxFencesForMessages
  getRunMailboxFence: typeof getRunMailboxFence
}

export function attachRunMailboxFence(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    bumpRunMailboxFence,
    bumpRunMailboxFencesForMessages,
    getRunMailboxFence
  })
}
