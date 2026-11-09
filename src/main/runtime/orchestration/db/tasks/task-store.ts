import type Database from '../../../../sqlite/sync-database'
import type { TaskStatus, TaskRow } from '../../types'
import { buildOrchestrationTaskDisplayMetadata } from '../../../../../shared/orchestration-task-display'
import { generateId } from '../generated-id'
import type { TaskRuntimeLineageRow } from '../run-list-page'
import type { OrchestrationDb } from '../orchestration-db'
import { transitionLifecycleWithDb } from '../lifecycle-transition'
import { runLifecycleWriteTransaction } from '../lifecycle-write-transaction-runner'
import { TASK_COLUMN_LIST, TASK_COLUMN_LIST_ALIASED } from '../row-column-lists'
import {
  isUniqueMessageIdError,
  taskBindingConflictError,
  validateTaskBinding,
  type TaskBindingInput
} from './task-binding-store'

const TASK_CREATE_SAVEPOINT = 'task_create_binding'

export function createTask(
  this: OrchestrationDb,
  task: {
    spec: string
    taskTitle?: string
    displayName?: string
    deps?: string[]
    parentId?: string
    createdByTerminalHandle?: string
    createdByPaneKey?: string
    createdByProcessIncarnation?: string
    createdByRunGeneration?: number
    runId?: string
    binding?: TaskBindingInput
  }
): TaskRow {
  const runId = task.runId
  if (!runId) {
    throw new Error('Run is required')
  }
  const binding = task.binding
  if (binding) {
    validateTaskBinding(binding)
  }
  this.requireRun(runId)
  if (task.parentId) {
    const parent = this.getTask(task.parentId)
    if (!parent || parent.run_id !== runId) {
      throw new Error(`Parent task ${task.parentId} must belong to run ${runId}`)
    }
  }
  for (const depId of task.deps ?? []) {
    const dependency = this.getTask(depId)
    if (!dependency || dependency.run_id !== runId) {
      throw new Error(`Dependency task ${depId} must belong to run ${runId}`)
    }
  }
  const id = generateId('task')
  const depsJson = JSON.stringify(task.deps ?? [])
  const display = buildOrchestrationTaskDisplayMetadata({
    spec: task.spec,
    taskTitle: task.taskTitle,
    displayName: task.displayName
  })
  return runLifecycleWriteTransaction(this.db, TASK_CREATE_SAVEPOINT, () => {
    if (binding) {
      const existing = this.getTaskByMessageId(binding.messageId)
      if (existing) {
        throw taskBindingConflictError(existing, binding)
      }
    }
    try {
      this.db
        .prepare(
          `INSERT INTO tasks (
             id, run_id, parent_id, created_by_terminal_handle, created_by_pane_key,
             created_by_process_incarnation, created_by_run_generation,
             task_title, display_name, spec, status, deps,
             message_id, card_digest, intent_job, intent_run, binding_generation
           ) VALUES (
             ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
             CASE WHEN EXISTS (
               SELECT 1
               FROM json_each(?) requested
               LEFT JOIN tasks dependency ON dependency.id = requested.value
               WHERE dependency.id IS NULL
                  OR dependency.run_id <> ?
                  OR dependency.status <> 'completed'
             ) THEN 'pending' ELSE 'ready' END,
             ?, ?, ?, ?, ?, 1
           )`
        )
        .run(
          id,
          runId,
          task.parentId ?? null,
          task.createdByTerminalHandle ?? null,
          task.createdByPaneKey ?? null,
          task.createdByProcessIncarnation ?? null,
          task.createdByRunGeneration ?? null,
          display.taskTitle || null,
          display.displayName || null,
          task.spec,
          depsJson,
          runId,
          depsJson,
          binding?.messageId ?? null,
          binding?.cardDigest ?? null,
          binding?.intentJob ?? null,
          binding?.intentRun ?? null
        )
    } catch (error) {
      if (binding && isUniqueMessageIdError(error)) {
        const existing = this.getTaskByMessageId(binding.messageId)
        if (existing) {
          throw taskBindingConflictError(existing, binding)
        }
      }
      throw error
    }
    if (binding) {
      this.insertTaskBindingIntent(id, binding, task.createdByTerminalHandle ?? null)
    }
    return this.db.prepare(`SELECT ${TASK_COLUMN_LIST} FROM tasks WHERE id = ?`).get(id) as TaskRow
  })
}

// Hoist the explicit lineage query to reuse its statement-cache entry.
const TASK_RUNTIME_LINEAGE_SQL = `SELECT ${TASK_COLUMN_LIST_ALIASED},
         creator.id AS creator_dispatch_id,
         creator.run_id AS creator_dispatch_run_id,
         creator.assignee_pane_key AS creator_dispatch_pane_key,
         creator.process_incarnation AS creator_dispatch_process_incarnation
       FROM tasks t
       LEFT JOIN dispatch_contexts creator ON creator.rowid = (
         SELECT candidate.rowid
         FROM dispatch_contexts candidate
         WHERE candidate.assignee_handle = t.created_by_terminal_handle
           AND candidate.run_id = ?
           AND candidate.status IN ('pending', 'dispatched')
         ORDER BY candidate.rowid DESC
         LIMIT 1
       )
       WHERE t.id = ?`

// Read creator Dispatch proof with the Task; runtime still verifies current pane/process identity.
export function getTask(this: OrchestrationDb, id: string): TaskRow | undefined
export function getTask(
  this: OrchestrationDb,
  id: string,
  dispatchRunId: string
): TaskRuntimeLineageRow | undefined
export function getTask(
  this: OrchestrationDb,
  id: string,
  dispatchRunId?: string
): TaskRow | TaskRuntimeLineageRow | undefined {
  if (dispatchRunId === undefined) {
    return this.db.prepare(`SELECT ${TASK_COLUMN_LIST} FROM tasks WHERE id = ?`).get(id) as
      | TaskRow
      | undefined
  }
  return this.db.prepare(TASK_RUNTIME_LINEAGE_SQL).get(dispatchRunId, id) as
    | TaskRuntimeLineageRow
    | undefined
}

export function listTasks(
  this: OrchestrationDb,
  filter?: {
    status?: TaskStatus
    ready?: boolean
    runId?: string
    messageId?: string
    cardDigest?: string
  }
): TaskRow[] {
  const where: string[] = []
  const params: Database.BindValue[] = []
  if (filter?.runId) {
    where.push('run_id = ?')
    params.push(filter.runId)
  }
  if (filter?.ready) {
    where.push("status = 'ready'")
  } else if (filter?.status) {
    where.push('status = ?')
    params.push(filter.status)
  }
  if (filter?.messageId) {
    where.push('message_id = ?')
    params.push(filter.messageId)
  }
  if (filter?.cardDigest) {
    where.push('card_digest = ?')
    params.push(filter.cardDigest)
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
  return this.db
    .prepare(`SELECT ${TASK_COLUMN_LIST} FROM tasks ${whereSql} ORDER BY created_at`)
    .all(...params) as TaskRow[]
}

// Use an indexed correlated lookup instead of materializing every retained Dispatch.
export function listTasksWithDispatch(
  this: OrchestrationDb,
  filter?: {
    status?: TaskStatus
    ready?: boolean
    runId?: string
    messageId?: string
    cardDigest?: string
  }
): (TaskRow & {
  assignee_handle: string | null
  dispatch_id: string | null
})[] {
  const whereClauses: string[] = []
  const params: Database.BindValue[] = []
  if (filter?.runId) {
    whereClauses.push('t.run_id = ?')
    params.push(filter.runId)
  }
  if (filter?.ready) {
    whereClauses.push("t.status = 'ready'")
  } else if (filter?.status) {
    whereClauses.push('t.status = ?')
    params.push(filter.status)
  }
  if (filter?.messageId) {
    whereClauses.push('t.message_id = ?')
    params.push(filter.messageId)
  }
  if (filter?.cardDigest) {
    whereClauses.push('t.card_digest = ?')
    params.push(filter.cardDigest)
  }
  const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''
  const sql = `
    SELECT
      t.*,
      d.assignee_handle AS assignee_handle,
      d.id              AS dispatch_id
    FROM tasks t
    LEFT JOIN dispatch_contexts d ON d.rowid = (
      SELECT candidate.rowid
      FROM dispatch_contexts candidate
      WHERE candidate.task_id = t.id
        AND candidate.status IN ('pending', 'dispatched')
      ORDER BY candidate.rowid DESC
      LIMIT 1
    )
    ${where}
    ORDER BY t.created_at
  `
  return this.db.prepare(sql).all(...params) as (TaskRow & {
    assignee_handle: string | null
    dispatch_id: string | null
  })[]
}

// Promote children inside the completion transaction so ready work cannot be stranded.
export function promoteReadyTasks(this: OrchestrationDb, completedTaskId: string): void {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the tasks schema supplies the same TEXT id/deps columns as TaskRow.
  const candidates = this.db
    .prepare("SELECT id, deps FROM tasks WHERE status = 'pending'")
    .all() as Pick<TaskRow, 'id' | 'deps'>[]

  for (const task of candidates) {
    const deps: string[] = JSON.parse(task.deps)
    if (!deps.includes(completedTaskId)) {
      continue
    }

    const allDepsCompleted = deps.every((depId) => {
      const dep = this.getTask(depId)
      return dep?.status === 'completed'
    })
    if (allDepsCompleted) {
      transitionLifecycleWithDb(this.db, {
        entity: 'task',
        id: task.id,
        from: 'pending',
        to: 'ready'
      })
    }
  }
}

export type TaskStoreMethods = {
  createTask: typeof createTask
  getTask: typeof getTask
  listTasks: typeof listTasks
  listTasksWithDispatch: typeof listTasksWithDispatch
  promoteReadyTasks: typeof promoteReadyTasks
}

export function attachTaskStore(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    createTask,
    getTask,
    listTasks,
    listTasksWithDispatch,
    promoteReadyTasks
  })
}
