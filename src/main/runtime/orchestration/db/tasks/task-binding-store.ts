import type { TaskBindingIntentRow, TaskRow } from '../../types'
import { OrchestrationError } from '../../orchestration-error'
import { generateId } from '../generated-id'
import type { OrchestrationDb } from '../orchestration-db'
import { TASK_COLUMN_LIST } from '../row-column-lists'

const CARD_DIGEST_PATTERN = /^[0-9a-f]{64}$/

export type TaskBindingInput = {
  messageId: string
  cardDigest: string
  intentJob: string
  intentRun: string
}

/** Fail closed on partial or malformed bindings; the RPC schema mirrors these checks. */
export function validateTaskBinding(binding: TaskBindingInput): void {
  const fields = [binding.messageId, binding.cardDigest, binding.intentJob, binding.intentRun]
  if (fields.some((value) => typeof value !== 'string' || value.length === 0)) {
    throw new OrchestrationError(
      'invalid_argument',
      'A message binding requires --message-id, --card, --intent-job and --intent-run together.'
    )
  }
  if (!CARD_DIGEST_PATTERN.test(binding.cardDigest)) {
    throw new OrchestrationError(
      'invalid_argument',
      '--card must be exactly 64 lowercase hex characters (sha256).'
    )
  }
}

export function taskBindingConflictError(
  existing: TaskRow,
  binding: TaskBindingInput
): OrchestrationError {
  const sameBinding =
    existing.message_id === binding.messageId &&
    existing.card_digest === binding.cardDigest &&
    (existing.intent_job ?? null) === binding.intentJob &&
    (existing.intent_run ?? null) === binding.intentRun
  return new OrchestrationError(
    'K_CONFLICT',
    `Message ${binding.messageId} is already bound to Task ${existing.id}; no Task was created.`,
    {
      existing_task_id: existing.id,
      existing: {
        message_id: existing.message_id,
        card_digest: existing.card_digest,
        intent_job: existing.intent_job,
        intent_run: existing.intent_run,
        generation: existing.binding_generation
      },
      reason: sameBinding ? 'same_message' : 'binding_mismatch'
    }
  )
}

/** Any M/C/J identity collision is one structured conflict class. */
export function isUniqueBindingError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes('tasks.message_id') ||
      error.message.includes('tasks.card_digest') ||
      error.message.includes('tasks.intent_job') ||
      error.message.includes('task_binding_intents.message_id'))
  )
}

/** Fail closed when a unique violation's winner cannot be read; never report a false absence. */
export function bindingIntegrityConflictError(binding: TaskBindingInput): OrchestrationError {
  return new OrchestrationError(
    'K_CONFLICT',
    `A conflicting binding for message ${binding.messageId} exists but its winner could not be read; no Task was created.`,
    { existing_task_id: null, existing: null, reason: 'binding_mismatch' }
  )
}

/** Authoritative K lookup: at most one row per message id, enforced by a partial unique index. */
export function getTaskByMessageId(this: OrchestrationDb, messageId: string): TaskRow | undefined {
  return this.db
    .prepare(`SELECT ${TASK_COLUMN_LIST} FROM tasks WHERE message_id = ?`)
    .get(messageId) as TaskRow | undefined
}

export function getTaskByCardDigest(
  this: OrchestrationDb,
  cardDigest: string
): TaskRow | undefined {
  return this.db
    .prepare(`SELECT ${TASK_COLUMN_LIST} FROM tasks WHERE card_digest = ?`)
    .get(cardDigest) as TaskRow | undefined
}

export function getTaskByIntentJob(
  this: OrchestrationDb,
  intentJob: string
): TaskRow | undefined {
  return this.db
    .prepare(`SELECT ${TASK_COLUMN_LIST} FROM tasks WHERE intent_job = ?`)
    .get(intentJob) as TaskRow | undefined
}

/** Global identity order: original message, then exact card, then fully-qualified intent job. */
export function findTaskBindingConflict(
  this: OrchestrationDb,
  binding: TaskBindingInput
): TaskRow | undefined {
  return (
    this.getTaskByMessageId(binding.messageId) ??
    this.getTaskByCardDigest(binding.cardDigest) ??
    this.getTaskByIntentJob(binding.intentJob)
  )
}

export function listTaskBindingIntents(
  this: OrchestrationDb,
  taskId: string
): TaskBindingIntentRow[] {
  return this.db
    .prepare('SELECT * FROM task_binding_intents WHERE task_id = ? ORDER BY rowid')
    .all(taskId) as TaskBindingIntentRow[]
}

/** Written inside the Task-create transaction, so a crash cannot leave one without the other. */
export function insertTaskBindingIntent(
  this: OrchestrationDb,
  taskId: string,
  binding: TaskBindingInput,
  ownerTerminalHandle: string | null
): void {
  this.db
    .prepare(
      `INSERT INTO task_binding_intents (
         intent_id, message_id, card_digest, intent_job, intent_run,
         owner_terminal_handle, generation, state, task_id, error, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, 1, 'committed', ?, NULL, datetime('now'), datetime('now'))`
    )
    .run(
      generateId('intent'),
      binding.messageId,
      binding.cardDigest,
      binding.intentJob,
      binding.intentRun,
      ownerTerminalHandle,
      taskId
    )
}

export type TaskBindingStoreMethods = {
  getTaskByMessageId: typeof getTaskByMessageId
  getTaskByCardDigest: typeof getTaskByCardDigest
  getTaskByIntentJob: typeof getTaskByIntentJob
  findTaskBindingConflict: typeof findTaskBindingConflict
  listTaskBindingIntents: typeof listTaskBindingIntents
  insertTaskBindingIntent: typeof insertTaskBindingIntent
}

export function attachTaskBindingStore(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    getTaskByMessageId,
    getTaskByCardDigest,
    getTaskByIntentJob,
    findTaskBindingConflict,
    listTaskBindingIntents,
    insertTaskBindingIntent
  })
}
