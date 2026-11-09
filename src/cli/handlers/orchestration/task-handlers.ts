import type { CommandHandler } from '../../dispatch'
import { printResult } from '../../format'
import { getOptionalStringFlag, getRequiredStringFlag } from '../../flags'
import { RuntimeClientError } from '../../runtime-client'
import { abbreviateOrchestrationTasks } from '../../../shared/orchestration-task-summary'
import { callOrchestrationMutation } from './mutation-request'
import { resolveCoordinatorTerminalHandle, runScopedSessionCaller } from './terminal-identity'

const TASK_STATUS_VALUES = [
  'pending',
  'ready',
  'dispatched',
  'completed',
  'failed',
  'blocked'
] as const

export const ORCHESTRATION_TASK_HANDLERS: Record<string, CommandHandler> = {
  'orchestration task-create': async ({ flags, client, cwd, json }) => {
    const callerTerminalHandle = await resolveCoordinatorTerminalHandle(flags, cwd, client)
    const result = await callOrchestrationMutation<{ task: { id: string; status: string } }>(
      client,
      flags,
      'orchestration.taskCreate',
      {
        spec: getRequiredStringFlag(flags, 'spec'),
        taskTitle: getOptionalStringFlag(flags, 'task-title'),
        displayName: getOptionalStringFlag(flags, 'display-name'),
        deps: getOptionalStringFlag(flags, 'deps'),
        parent: getOptionalStringFlag(flags, 'parent'),
        messageId: getOptionalStringFlag(flags, 'message-id'),
        cardDigest: getOptionalStringFlag(flags, 'card'),
        intentJob: getOptionalStringFlag(flags, 'intent-job'),
        intentRun: getOptionalStringFlag(flags, 'intent-run'),
        run: getOptionalStringFlag(flags, 'run'),
        callerTerminalHandle
      }
    )
    printResult(result, json, (r) => `Created ${r.task.id} [${r.task.status}]`)
  },

  'orchestration task-list': async ({ flags, client, cwd, json }) => {
    const brief = flags.has('brief')
    const run = getOptionalStringFlag(flags, 'run')
    const callerTerminalHandle = run
      ? runScopedSessionCaller(flags)
      : await resolveCoordinatorTerminalHandle(flags, cwd, client)
    const result = await client.call<{
      tasks: {
        id: string
        spec: string
        task_title?: string | null
        display_name?: string | null
        status: string
        assignee_handle?: string | null
        dispatch_id?: string | null
        spec_truncated?: boolean
      }[]
      count: number
      runId?: string
      legacyReadOnly?: boolean
    }>('orchestration.taskList', {
      status: getOptionalStringFlag(flags, 'status'),
      ready: flags.has('ready') ? true : undefined,
      brief: brief ? true : undefined,
      messageId: getOptionalStringFlag(flags, 'message-id'),
      cardDigest: getOptionalStringFlag(flags, 'card'),
      run,
      callerTerminalHandle
    })
    // Only hosts that omit spec_truncated need client-side abbreviation.
    const needsClientAbbreviation =
      brief && result.result.tasks.some((task) => task.spec_truncated === undefined)
    const output = needsClientAbbreviation
      ? {
          ...result,
          result: { ...result.result, tasks: abbreviateOrchestrationTasks(result.result.tasks) }
        }
      : result
    printResult(output, json, (r) => {
      if (r.count === 0) {
        return r.legacyReadOnly ? 'No legacy tasks (read-only).' : 'No tasks.'
      }
      const tasks = r.tasks
        .map((task) => {
          const label = task.display_name ?? task.task_title ?? task.spec
          const head = `${task.id} [${task.status}] ${label.slice(0, 60)}`
          if (task.status === 'dispatched' && task.assignee_handle) {
            return `${head} -> ${task.assignee_handle} (${task.dispatch_id ?? '?'})`
          }
          return head
        })
        .join('\n')
      return r.legacyReadOnly ? `Legacy Run ${r.runId} (read-only)\n${tasks}` : tasks
    })
  },

  'orchestration task-show': async ({ flags, client, cwd, json }) => {
    const run = getOptionalStringFlag(flags, 'run')
    const callerTerminalHandle = run
      ? runScopedSessionCaller(flags)
      : await resolveCoordinatorTerminalHandle(flags, cwd, client)
    const result = await client.call<{
      task: {
        id: string
        spec: string
        task_title?: string | null
        display_name?: string | null
        status: string
      }
      binding: {
        message_id: string
        card_digest: string
        intent_job: string | null
        intent_run: string | null
        generation: number
        conflict: boolean
        task_id: string
      } | null
      intents: unknown[]
      runId?: string
    }>('orchestration.taskShow', {
      id: getRequiredStringFlag(flags, 'id'),
      run,
      callerTerminalHandle
    })
    printResult(result, json, (r) => {
      const label = r.task.display_name ?? r.task.task_title ?? r.task.spec
      const head = `${r.task.id} [${r.task.status}] ${label.slice(0, 60)}`
      if (!r.binding) {
        return head
      }
      return (
        `${head}\n` +
        `binding message=${r.binding.message_id} card=${r.binding.card_digest} ` +
        `job=${r.binding.intent_job ?? '-'} run=${r.binding.intent_run ?? '-'} ` +
        `generation=${r.binding.generation} intents=${r.intents.length}`
      )
    })
  },

  'orchestration task-update': async ({ flags, client, cwd, json }) => {
    const status = getRequiredStringFlag(flags, 'status')
    if (!TASK_STATUS_VALUES.includes(status as (typeof TASK_STATUS_VALUES)[number])) {
      throw new RuntimeClientError(
        'invalid_argument',
        `invalid status '${status}', expected one of: ${TASK_STATUS_VALUES.join(', ')}`
      )
    }
    const result = await callOrchestrationMutation<{ task: { id: string; status: string } }>(
      client,
      flags,
      'orchestration.taskUpdate',
      {
        id: getRequiredStringFlag(flags, 'id'),
        status,
        result: getOptionalStringFlag(flags, 'result'),
        run: getOptionalStringFlag(flags, 'run'),
        callerTerminalHandle: await resolveCoordinatorTerminalHandle(flags, cwd, client)
      }
    )
    printResult(result, json, (r) => `Updated ${r.task.id} -> ${r.task.status}`)
  }
}
