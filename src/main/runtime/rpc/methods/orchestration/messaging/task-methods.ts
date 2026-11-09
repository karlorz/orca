import type { TaskRow, TaskStatus } from '../../../../orchestration/db'
import { OrchestrationError } from '../../../../orchestration/orchestration-error'
import { abbreviateOrchestrationTasks } from '../../../../../../shared/orchestration-task-summary'
import { parseOrchestrationTaskDepsFlag } from '../../../../orchestration/task-deps-flag'
import { defineMethod } from '../../../core'
import { orchestrationCallerIdentity, resolveRunScope } from '../runs/run-scope'
import { TaskCreateParams, TaskListParams, TaskShowParams, TaskUpdateParams } from '../schemas'

function exposeTaskBinding(task: TaskRow) {
  if (!task.message_id || !task.card_digest) {
    return null
  }
  return {
    message_id: task.message_id,
    card_digest: task.card_digest,
    intent_job: task.intent_job,
    intent_run: task.intent_run,
    generation: task.binding_generation,
    conflict: false,
    task_id: task.id
  }
}

export const ORCHESTRATION_TASK_METHODS = [
  defineMethod({
    name: 'orchestration.taskCreate',
    permission: 'workspace',
    params: TaskCreateParams,
    handler: (
      params,
      { orchestrationCompatibilityEvidence, orchestrationCaller, runtime, legacyCoordinatorRunId }
    ) => {
      const db = runtime.getOrchestrationDb()
      const deps = params.deps ? parseOrchestrationTaskDepsFlag(params.deps) : undefined
      const run = resolveRunScope(runtime, {
        runId: params.run,
        callerTerminalHandle: params.callerTerminalHandle,
        requireCurrentConsumer: true,
        legacyCoordinatorRunId,
        callerEvidence: orchestrationCompatibilityEvidence,
        callerSession: orchestrationCaller
      })
      // A handle-less session creates root Tasks: Task lineage is recorded by terminal only.
      const creatorHandle = params.callerTerminalHandle
        ? orchestrationCallerIdentity(runtime, {
            handle: params.callerTerminalHandle,
            session: orchestrationCaller,
            paneKey: null
          }).terminalHandle
        : null
      const creatorAuthority = creatorHandle
        ? runtime.getOrchestrationDispatchAuthority(creatorHandle)
        : null
      const binding =
        params.messageId !== undefined && params.cardDigest !== undefined
          ? {
              messageId: params.messageId,
              cardDigest: params.cardDigest,
              intentJob: params.intentJob ?? '',
              intentRun: params.intentRun ?? ''
            }
          : undefined
      const task = db.createTask({
        spec: params.spec,
        taskTitle: params.taskTitle,
        displayName: params.displayName,
        deps,
        parentId: params.parent,
        createdByTerminalHandle: creatorHandle ?? undefined,
        ...(creatorAuthority?.paneKey && creatorAuthority.processIncarnation
          ? {
              createdByPaneKey: creatorAuthority.paneKey,
              createdByProcessIncarnation: creatorAuthority.processIncarnation,
              createdByRunGeneration: run.consumer_generation
            }
          : {}),
        runId: run.id,
        binding
      })
      return { task, binding: exposeTaskBinding(task) }
    }
  }),

  defineMethod({
    name: 'orchestration.taskList',
    permission: 'workspace',
    params: TaskListParams,
    handler: (
      params,
      { orchestrationCompatibilityEvidence, orchestrationCaller, runtime, legacyCoordinatorRunId }
    ) => {
      const db = runtime.getOrchestrationDb()
      if (params.globalBinding === true) {
        const task = db.getTaskByMessageId(params.messageId ?? '')
        return {
          scope: 'global',
          bound: task !== undefined,
          task_id: task?.id ?? null,
          binding: task ? exposeTaskBinding(task) : null
        }
      }
      const explicitRun = params.run ? db.getRun(params.run) : undefined
      const run =
        explicitRun?.legacy === 1
          ? explicitRun
          : resolveRunScope(runtime, {
              runId: params.run,
              callerTerminalHandle: params.callerTerminalHandle,
              requireCurrentConsumer: params.run === undefined,
              legacyCoordinatorRunId,
              callerEvidence: orchestrationCompatibilityEvidence,
              callerSession: orchestrationCaller
            })
      // Add nullable assignee_handle/dispatch_id without changing legacy non-dispatched rows.
      const joined = db.listTasksWithDispatch({
        status: params.status as TaskStatus,
        ready: params.ready,
        runId: run.id,
        messageId: params.messageId,
        cardDigest: params.cardDigest
      })
      const tasks = joined.map((row) => {
        const { assignee_handle, dispatch_id, ...base } = row
        const binding = exposeTaskBinding(base)
        if (base.status === 'dispatched') {
          return { ...base, assignee_handle, dispatch_id, binding }
        }
        return { ...base, binding }
      })
      return {
        runId: run.id,
        legacyReadOnly: run.legacy === 1,
        scope: 'run-filtered',
        global_binding_exists: params.messageId
          ? Boolean(db.getTaskByMessageId(params.messageId))
          : null,
        tasks: params.brief ? abbreviateOrchestrationTasks(tasks) : tasks,
        count: tasks.length
      }
    }
  }),

  defineMethod({
    name: 'orchestration.taskShow',
    permission: 'workspace',
    params: TaskShowParams,
    handler: (
      params,
      { orchestrationCompatibilityEvidence, orchestrationCaller, runtime, legacyCoordinatorRunId }
    ) => {
      const db = runtime.getOrchestrationDb()
      const explicitRun = params.run ? db.getRun(params.run) : undefined
      const run =
        explicitRun?.legacy === 1
          ? explicitRun
          : resolveRunScope(runtime, {
              runId: params.run,
              callerTerminalHandle: params.callerTerminalHandle,
              requireCurrentConsumer: params.run === undefined,
              legacyCoordinatorRunId,
              callerEvidence: orchestrationCompatibilityEvidence,
              callerSession: orchestrationCaller
            })
      const task = db.getTask(params.id)
      if (!task || task.run_id !== run.id) {
        throw new OrchestrationError(
          'task_not_found',
          `Task ${params.id} was not found in Run ${run.id}.`
        )
      }
      return {
        runId: run.id,
        legacyReadOnly: run.legacy === 1,
        task,
        binding: exposeTaskBinding(task),
        intents: db.listTaskBindingIntents(task.id)
      }
    }
  }),

  defineMethod({
    name: 'orchestration.taskUpdate',
    permission: 'workspace',
    params: TaskUpdateParams,
    handler: (
      params,
      { orchestrationCompatibilityEvidence, orchestrationCaller, runtime, legacyCoordinatorRunId }
    ) => {
      const db = runtime.getOrchestrationDb()
      const run = resolveRunScope(runtime, {
        runId: params.run,
        callerTerminalHandle: params.callerTerminalHandle,
        requireCurrentConsumer: true,
        legacyCoordinatorRunId,
        callerEvidence: orchestrationCompatibilityEvidence,
        callerSession: orchestrationCaller
      })
      const existing = db.getTask(params.id)
      if (!existing || existing.run_id !== run.id) {
        throw new OrchestrationError(
          'task_not_found',
          `Task ${params.id} was not found in Run ${run.id}.`
        )
      }
      const task = db.updateTaskStatus(params.id, params.status, params.result)
      if (!task) {
        throw new Error(`Task not found: ${params.id}`)
      }
      return { task }
    }
  })
]
