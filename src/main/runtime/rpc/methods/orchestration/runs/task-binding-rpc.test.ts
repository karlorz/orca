import { afterEach, describe, expect, it } from 'vitest'
import type { RpcContext } from '../../../core'
import { createOrchestrationRpcHarness } from '../rpc-test-harness'
import type { OrchestrationDb } from '../../../../orchestration/db'

const CARD = 'c'.repeat(64)
const OTHER_CARD = 'd'.repeat(64)

describe('orchestration task unique binding RPC', () => {
  const h = createOrchestrationRpcHarness()
  let db: OrchestrationDb
  let ctx: RpcContext
  let activeRunId: string | undefined

  function setup(): void {
    ;({ db, ctx, activeRunId } = h.setup())
  }

  afterEach(() => {
    h.cleanup()
  })

  async function call(name: string, params: Record<string, unknown>) {
    return h.call(name, params, ctx)
  }

  function bindingParams(messageId = 'msg_rpc_bind_1') {
    return {
      messageId,
      cardDigest: CARD,
      intentJob: 'job_rpc_1',
      intentRun: 'run_rpc_1'
    }
  }

  it('returns the binding on create and rejects a duplicate without a second row', async () => {
    setup()
    const created = (await call('orchestration.taskCreate', {
      spec: 'bound task',
      ...bindingParams()
    })) as {
      task: { id: string }
      binding: {
        message_id: string
        card_digest: string
        intent_job: string
        intent_run: string
        generation: number
        conflict: boolean
        task_id: string
      }
    }

    expect(created.binding).toEqual({
      message_id: 'msg_rpc_bind_1',
      card_digest: CARD,
      intent_job: 'job_rpc_1',
      intent_run: 'run_rpc_1',
      generation: 1,
      conflict: false,
      task_id: created.task.id
    })

    await expect(
      call('orchestration.taskCreate', { spec: 'duplicate', ...bindingParams() })
    ).rejects.toMatchObject({
      code: 'K_CONFLICT',
      data: {
        existing_task_id: created.task.id,
        existing: {
          message_id: 'msg_rpc_bind_1',
          card_digest: CARD,
          intent_job: 'job_rpc_1',
          intent_run: 'run_rpc_1',
          generation: 1
        },
        reason: 'same_message'
      }
    })
    expect(db.listTasks({ runId: activeRunId, messageId: 'msg_rpc_bind_1' })).toHaveLength(1)
  })

  it('reports binding_mismatch for the same message with another card', async () => {
    setup()
    const created = (await call('orchestration.taskCreate', {
      spec: 'bound task',
      ...bindingParams()
    })) as { task: { id: string } }

    await expect(
      call('orchestration.taskCreate', {
        spec: 'mismatch',
        ...bindingParams(),
        cardDigest: OTHER_CARD
      })
    ).rejects.toMatchObject({
      code: 'K_CONFLICT',
      data: { existing_task_id: created.task.id, reason: 'binding_mismatch' }
    })
  })

  it('rejects a partial or malformed binding at the schema boundary', async () => {
    setup()
    await expect(
      call('orchestration.taskCreate', { spec: 'partial', messageId: 'msg_partial' })
    ).rejects.toThrow()
    await expect(
      call('orchestration.taskCreate', {
        spec: 'bad card',
        ...bindingParams('msg_bad_card'),
        cardDigest: 'NOT-HEX'
      })
    ).rejects.toThrow()
    expect(db.listTasks({ runId: activeRunId })).toHaveLength(0)
  })

  it('answers the K query with exact count and per-row binding', async () => {
    setup()
    const created = (await call('orchestration.taskCreate', {
      spec: 'bound task',
      ...bindingParams()
    })) as { task: { id: string } }

    const found = (await call('orchestration.taskList', { messageId: 'msg_rpc_bind_1' })) as {
      count: number
      tasks: { id: string; binding: { message_id: string; task_id: string } | null }[]
    }
    expect(found.count).toBe(1)
    expect(found.tasks).toHaveLength(1)
    expect(found.tasks[0].id).toBe(created.task.id)
    expect(found.tasks[0].binding).toMatchObject({
      message_id: 'msg_rpc_bind_1',
      task_id: created.task.id
    })

    const empty = (await call('orchestration.taskList', {
      messageId: 'msg_rpc_absent'
    })) as { count: number; tasks: unknown[] }
    expect(empty.count).toBe(0)
    expect(empty.tasks).toEqual([])
  })

  it('labels wrong-Run, wrong-card and status-filter zeros as scoped absence', async () => {
    setup()
    const created = (await call('orchestration.taskCreate', {
      spec: 'bound task',
      ...bindingParams()
    })) as { task: { id: string } }
    const otherRun = db.createRun({
      objective: 'other',
      coordinatorHandle: 'term_other',
      coordinatorPaneKey: 'tab_other:33333333-3333-4333-8333-333333333333'
    })

    const wrongRun = (await call('orchestration.taskList', {
      run: otherRun.id,
      messageId: 'msg_rpc_bind_1'
    })) as { count: number; scope: string; global_binding_exists: boolean | null }
    expect(wrongRun.count).toBe(0)
    expect(wrongRun.scope).toBe('run-filtered')
    expect(wrongRun.global_binding_exists).toBe(true)
    expect(JSON.stringify(wrongRun)).not.toContain(created.task.id)

    const wrongCard = (await call('orchestration.taskList', {
      messageId: 'msg_rpc_bind_1',
      cardDigest: OTHER_CARD
    })) as { count: number; global_binding_exists: boolean | null }
    expect(wrongCard.count).toBe(0)
    expect(wrongCard.global_binding_exists).toBe(true)

    const wrongStatus = (await call('orchestration.taskList', {
      messageId: 'msg_rpc_bind_1',
      status: 'completed'
    })) as { count: number; global_binding_exists: boolean | null }
    expect(wrongStatus.count).toBe(0)
    expect(wrongStatus.global_binding_exists).toBe(true)
  })

  it('answers the global binding probe across Runs', async () => {
    setup()
    const created = (await call('orchestration.taskCreate', {
      spec: 'bound task',
      ...bindingParams()
    })) as { task: { id: string } }

    const hit = (await call('orchestration.taskList', {
      messageId: 'msg_rpc_bind_1',
      globalBinding: true
    })) as {
      scope: string
      bound: boolean
      task_id: string | null
      binding: { message_id: string; card_digest: string; task_id: string } | null
    }
    expect(hit.scope).toBe('global')
    expect(hit.bound).toBe(true)
    expect(hit.task_id).toBe(created.task.id)
    expect(hit.binding).toMatchObject({
      message_id: 'msg_rpc_bind_1',
      card_digest: CARD,
      task_id: created.task.id
    })

    const miss = (await call('orchestration.taskList', {
      messageId: 'msg_rpc_absent',
      globalBinding: true
    })) as { scope: string; bound: boolean; task_id: string | null; binding: unknown }
    expect(miss).toEqual({
      scope: 'global',
      bound: false,
      task_id: null,
      binding: null
    })
  })

  it('rejects ambiguous global probe filters and requires a message id', async () => {
    setup()
    await expect(
      call('orchestration.taskList', {
        messageId: 'msg_rpc_bind_1',
        globalBinding: true,
        cardDigest: OTHER_CARD
      })
    ).rejects.toThrow()
    await expect(call('orchestration.taskList', { globalBinding: true })).rejects.toThrow()
  })

  it('shares the workspace access class with task-show', () => {
    expect(h.findMethod('orchestration.taskList').permission).toBe('workspace')
    expect(h.findMethod('orchestration.taskShow').permission).toBe('workspace')
  })

  it('shows the full row, binding and intent history', async () => {
    setup()
    const created = (await call('orchestration.taskCreate', {
      spec: 'bound task',
      ...bindingParams()
    })) as { task: { id: string } }

    const shown = (await call('orchestration.taskShow', {
      id: created.task.id,
      run: activeRunId,
      callerTerminalHandle: 'term_coord'
    })) as {
      task: { id: string; message_id: string; binding_generation: number }
      binding: { message_id: string; generation: number }
      intents: { message_id: string; state: string; task_id: string }[]
    }
    expect(shown.task).toMatchObject({
      id: created.task.id,
      message_id: 'msg_rpc_bind_1',
      binding_generation: 1
    })
    expect(shown.binding).toMatchObject({ message_id: 'msg_rpc_bind_1', generation: 1 })
    expect(shown.intents).toHaveLength(1)
    expect(shown.intents[0]).toMatchObject({
      message_id: 'msg_rpc_bind_1',
      state: 'committed',
      task_id: created.task.id
    })

    await expect(
      call('orchestration.taskShow', {
        id: 'task_missing',
        run: activeRunId,
        callerTerminalHandle: 'term_coord'
      })
    ).rejects.toMatchObject({ code: 'task_not_found' })
  })
})
