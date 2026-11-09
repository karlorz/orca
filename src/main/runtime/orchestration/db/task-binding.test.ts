import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { OrchestrationError } from '../orchestration-error'
import { LEGACY_RUN_ID } from './contract-constants'
import { OrchestrationDb } from './orchestration-db'
import type { TaskBindingInput } from './tasks/task-binding-store'

const runId = LEGACY_RUN_ID
const CARD_A = 'a'.repeat(64)
const CARD_B = 'b'.repeat(64)

function binding(overrides: Partial<TaskBindingInput> = {}): TaskBindingInput {
  return {
    messageId: 'msg_binding_target_1',
    cardDigest: CARD_A,
    intentJob: 'job_target_1',
    intentRun: 'run_target_1',
    ...overrides
  }
}

function captureOrchestrationError(operation: () => unknown): OrchestrationError {
  try {
    operation()
  } catch (error) {
    if (error instanceof OrchestrationError) {
      return error
    }
    throw error
  }
  throw new Error('Expected an OrchestrationError')
}

describe('task unique binding', () => {
  const connections: OrchestrationDb[] = []
  const directories: string[] = []
  afterEach(() => {
    for (const db of connections.splice(0)) {
      db.close()
    }
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })
  function open(path = ':memory:'): OrchestrationDb {
    const db = new OrchestrationDb(path)
    connections.push(db)
    return db
  }
  function databasePath(): string {
    const directory = mkdtempSync(join(tmpdir(), 'orca-task-binding-'))
    directories.push(directory)
    return join(directory, 'orchestration.db')
  }

  it('commits the Task and its intent row together with generation 1', () => {
    const db = open()
    const task = db.createTask({ runId, spec: 'bound work', binding: binding() })

    expect(task.message_id).toBe('msg_binding_target_1')
    expect(task.card_digest).toBe(CARD_A)
    expect(task.intent_job).toBe('job_target_1')
    expect(task.intent_run).toBe('run_target_1')
    expect(task.binding_generation).toBe(1)
    expect(db.getTaskByMessageId('msg_binding_target_1')?.id).toBe(task.id)

    const intents = db.listTaskBindingIntents(task.id)
    expect(intents).toHaveLength(1)
    expect(intents[0]).toMatchObject({
      message_id: 'msg_binding_target_1',
      card_digest: CARD_A,
      intent_job: 'job_target_1',
      intent_run: 'run_target_1',
      generation: 1,
      state: 'committed',
      task_id: task.id,
      error: null
    })
  })

  it('keeps one row and reports the winner when the same message is created twice', () => {
    const db = open()
    const winner = db.createTask({ runId, spec: 'first', binding: binding() })

    const conflict = captureOrchestrationError(() =>
      db.createTask({ runId, spec: 'second', binding: binding() })
    )

    expect(conflict.code).toBe('K_CONFLICT')
    expect(conflict.data).toEqual({
      existing_task_id: winner.id,
      existing: {
        message_id: 'msg_binding_target_1',
        card_digest: CARD_A,
        intent_job: 'job_target_1',
        intent_run: 'run_target_1',
        generation: 1
      },
      reason: 'same_message'
    })
    expect(db.listTasks({ messageId: 'msg_binding_target_1' })).toHaveLength(1)
    expect(db.listTaskBindingIntents(winner.id)).toHaveLength(1)
  })

  it('reports binding_mismatch when the same message carries a different card', () => {
    const db = open()
    const winner = db.createTask({ runId, spec: 'first', binding: binding() })

    const conflict = captureOrchestrationError(() =>
      db.createTask({ runId, spec: 'second', binding: binding({ cardDigest: CARD_B }) })
    )

    expect(conflict.code).toBe('K_CONFLICT')
    expect(conflict.data).toMatchObject({
      existing_task_id: winner.id,
      reason: 'binding_mismatch'
    })
    expect(db.listTasks({ messageId: 'msg_binding_target_1' })).toHaveLength(1)
  })

  it('rejects partial and malformed bindings before writing', () => {
    const db = open()

    for (const invalid of [
      binding({ intentJob: '' }),
      binding({ intentRun: '' }),
      binding({ messageId: '' }),
      binding({ cardDigest: CARD_A.toUpperCase() }),
      binding({ cardDigest: 'abc' })
    ]) {
      expect(() => db.createTask({ runId, spec: 'invalid', binding: invalid })).toThrow(
        expect.objectContaining({ code: 'invalid_argument' })
      )
    }
    expect(db.listTasks({ runId })).toHaveLength(0)
  })

  it('answers the K query with exact cardinality and count 0 when absent', () => {
    const db = open()
    const task = db.createTask({ runId, spec: 'bound', binding: binding() })

    const found = db.listTasks({ runId, messageId: 'msg_binding_target_1' })
    expect(found).toHaveLength(1)
    expect(found[0].id).toBe(task.id)
    expect(db.listTasks({ runId, cardDigest: CARD_A })).toHaveLength(1)
    expect(db.listTasks({ runId, cardDigest: CARD_B })).toHaveLength(0)
    expect(db.listTasks({ runId, messageId: 'msg_absent' })).toHaveLength(0)

    const joined = db.listTasksWithDispatch({ runId, messageId: 'msg_binding_target_1' })
    expect(joined).toHaveLength(1)
    expect(joined[0].id).toBe(task.id)
    expect(db.listTasksWithDispatch({ runId, messageId: 'msg_absent' })).toHaveLength(0)
  })

  it('keeps unbound Tasks creatable and distinct from bound ones', () => {
    const db = open()
    const unbound = db.createTask({ runId, spec: 'plain' })
    expect(unbound.message_id).toBeNull()
    expect(unbound.binding_generation).toBe(1)
    expect(db.listTaskBindingIntents(unbound.id)).toHaveLength(0)
  })

  it('rejects the same exact card under a different message and job', () => {
    const db = open()
    const winner = db.createTask({ runId, spec: 'first', binding: binding() })

    const conflict = captureOrchestrationError(() =>
      db.createTask({
        runId,
        spec: 'same card',
        binding: binding({
          messageId: 'msg_other_card',
          intentJob: 'job_other_card',
          intentRun: 'run_other_card'
        })
      })
    )

    expect(conflict.code).toBe('K_CONFLICT')
    expect(conflict.data).toMatchObject({
      existing_task_id: winner.id,
      reason: 'binding_mismatch'
    })
    expect(db.listTasks({ messageId: 'msg_other_card' })).toHaveLength(0)
    expect(db.listTaskBindingIntents(winner.id)).toHaveLength(1)
  })

  it('rejects the same card, job and run under a new message id', () => {
    const db = open()
    const winner = db.createTask({ runId, spec: 'first', binding: binding() })

    const conflict = captureOrchestrationError(() =>
      db.createTask({ runId, spec: 'second', binding: binding({ messageId: 'msg_second' }) })
    )

    expect(conflict.code).toBe('K_CONFLICT')
    expect(conflict.data).toMatchObject({
      existing_task_id: winner.id,
      reason: 'binding_mismatch'
    })
    expect(db.listTasks({ messageId: 'msg_second' })).toHaveLength(0)
    expect(db.listTasks({ runId })).toHaveLength(1)
  })

  it('rejects a new message and card that reuse the same intent job', () => {
    const db = open()
    const winner = db.createTask({ runId, spec: 'first', binding: binding() })

    const conflict = captureOrchestrationError(() =>
      db.createTask({
        runId,
        spec: 'same job',
        binding: binding({
          messageId: 'msg_other_job',
          cardDigest: CARD_B,
          intentRun: 'run_other_job'
        })
      })
    )

    expect(conflict.code).toBe('K_CONFLICT')
    expect(conflict.data).toMatchObject({
      existing_task_id: winner.id,
      reason: 'binding_mismatch'
    })
    expect(db.listTasks({ messageId: 'msg_other_job' })).toHaveLength(0)
    expect(db.getTaskByIntentJob('job_target_1')?.id).toBe(winner.id)
  })

  it('rejects changed intent job or run on the same message', () => {
    const db = open()
    const winner = db.createTask({ runId, spec: 'first', binding: binding() })

    for (const changed of [binding({ intentJob: 'job_changed' }), binding({ intentRun: 'run_changed' })]) {
      const conflict = captureOrchestrationError(() =>
        db.createTask({ runId, spec: 'changed', binding: changed })
      )
      expect(conflict.code).toBe('K_CONFLICT')
      expect(conflict.data).toMatchObject({
        existing_task_id: winner.id,
        reason: 'binding_mismatch'
      })
    }
    expect(db.listTasks({ messageId: 'msg_binding_target_1' })).toHaveLength(1)
  })

  it('rejects a cross-Run rebinding of the same message', () => {
    const db = open()
    const runA = db.createRun({
      objective: 'A',
      coordinatorHandle: 'term_a',
      coordinatorPaneKey: 'tab_a:11111111-1111-4111-8111-111111111111'
    })
    const runB = db.createRun({
      objective: 'B',
      coordinatorHandle: 'term_b',
      coordinatorPaneKey: 'tab_b:22222222-2222-4222-9222-222222222222'
    })
    const winner = db.createTask({ runId: runA.id, spec: 'first', binding: binding() })

    const conflict = captureOrchestrationError(() =>
      db.createTask({
        runId: runB.id,
        spec: 'rebind',
        binding: binding({
          cardDigest: CARD_B,
          intentJob: 'job_rebind',
          intentRun: 'run_rebind'
        })
      })
    )

    expect(conflict.code).toBe('K_CONFLICT')
    expect(conflict.data).toMatchObject({
      existing_task_id: winner.id,
      reason: 'binding_mismatch'
    })
    expect(winner.run_id).toBe(runA.id)
    expect(db.listTasks({ runId: runB.id })).toHaveLength(0)
    expect(db.getTaskByMessageId('msg_binding_target_1')?.run_id).toBe(runA.id)
  })

  it('keeps the first serialized winner across two database connections', () => {
    const path = databasePath()
    const first = open(path)
    const runA = first.createRun({
      objective: 'A',
      coordinatorHandle: 'term_a',
      coordinatorPaneKey: 'tab_a:11111111-1111-4111-8111-111111111111'
    })
    const winner = first.createTask({ runId: runA.id, spec: 'first', binding: binding() })

    const second = open(path)
    const runB = second.createRun({
      objective: 'B',
      coordinatorHandle: 'term_b',
      coordinatorPaneKey: 'tab_b:22222222-2222-4222-9222-222222222222'
    })
    const conflict = captureOrchestrationError(() =>
      second.createTask({ runId: runB.id, spec: 'second', binding: binding() })
    )

    expect(conflict.code).toBe('K_CONFLICT')
    expect(conflict.data).toMatchObject({
      existing_task_id: winner.id,
      reason: 'same_message'
    })
    expect(second.listTasks({ runId: runB.id })).toHaveLength(0)
  })

  it('reads the binding back after reopening a file-backed database', () => {
    const path = databasePath()
    const first = open(path)
    const run = first.createRun({
      objective: 'durability',
      coordinatorHandle: null,
      coordinatorPaneKey: null
    })
    const task = first.createTask({ runId: run.id, spec: 'durable', binding: binding() })
    first.close()
    connections.pop()

    const reopened = open(path)
    const found = reopened.listTasks({ runId: run.id, messageId: 'msg_binding_target_1' })
    expect(found).toHaveLength(1)
    expect(found[0].id).toBe(task.id)
    expect(found[0].binding_generation).toBe(1)
    expect(reopened.getTaskByMessageId('msg_binding_target_1')).toMatchObject({
      id: task.id,
      card_digest: CARD_A,
      intent_job: 'job_target_1',
      intent_run: 'run_target_1'
    })
    expect(reopened.listTaskBindingIntents(task.id)).toHaveLength(1)
  })
})
