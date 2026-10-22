import { defineMethod } from '../../core'
import { withTerminalCloseAttribution } from '../../terminal-close-attribution'
import { TerminalClose } from '../../../../../shared/rpc-contract/terminal-unary-params'
import { classifyGcTerminalIdle } from '../../../../../shared/worktree-gc-terminal-idle'
import type {
  RuntimeTerminalClose,
  RuntimeTerminalListResult,
  RuntimeTerminalRead
} from '../../../../../shared/runtime-types'

export type TerminalGcCloseParams = {
  terminal: string
  expectedIncarnationId?: string
  gcIdleTermMin?: number
  gcCoordHandle?: string
}

export type TerminalGcCloseRuntime = {
  listTerminals: (
    worktreeSelector?: string,
    limit?: number,
    opts?: { handles?: readonly string[]; includeVisualLayouts?: boolean }
  ) => Promise<RuntimeTerminalListResult>
  readTerminal: (handle: string, opts?: { limit?: number }) => Promise<RuntimeTerminalRead>
  closeTerminal: (
    handle: string,
    options?: {
      expectedIncarnationId?: string
      gcIdleTermMin?: number
      gcCoordHandle?: string
    }
  ) => Promise<RuntimeTerminalClose>
}

async function listedRow(runtime: TerminalGcCloseRuntime, handle: string) {
  const listed = await runtime.listTerminals(undefined, 1, {
    handles: [handle],
    includeVisualLayouts: false
  })
  return listed.terminals.find((entry) => entry.handle === handle)
}

async function evaluateGcIdleClose(
  runtime: TerminalGcCloseRuntime,
  params: TerminalGcCloseParams & { expectedIncarnationId: string; gcIdleTermMin: number },
  nowMs: number
): Promise<{ close: true } | { close: false; why: string }> {
  const before = await listedRow(runtime, params.terminal)
  if (!before) {
    return { close: false, why: 'revalidate-missing' }
  }
  if (!before.incarnationId) {
    return { close: false, why: 'incarnation-unverifiable' }
  }
  if (before.incarnationId !== params.expectedIncarnationId) {
    return { close: false, why: 'incarnation-changed' }
  }
  let tail: string
  try {
    const read = await runtime.readTerminal(params.terminal, { limit: 10 })
    tail = read.tail.join('\n')
  } catch {
    return { close: false, why: 'revalidate-unverifiable' }
  }
  const after = await listedRow(runtime, params.terminal)
  if (!after) {
    return { close: false, why: 'revalidate-missing' }
  }
  if (!after.incarnationId) {
    return { close: false, why: 'incarnation-unverifiable' }
  }
  if (after.incarnationId !== params.expectedIncarnationId) {
    return { close: false, why: 'incarnation-changed' }
  }
  const idle = classifyGcTerminalIdle({
    lastOutputAt: after.lastOutputAt,
    tail,
    nowMs,
    idleTermMin: params.gcIdleTermMin,
    isCoord: Boolean(params.gcCoordHandle && params.terminal === params.gcCoordHandle)
  })
  if (idle.action !== 'close') {
    return { close: false, why: idle.why }
  }
  return { close: true }
}

export async function closeTerminalFromRpc(
  runtime: TerminalGcCloseRuntime,
  params: TerminalGcCloseParams,
  nowMs = Date.now()
): Promise<RuntimeTerminalClose> {
  const expectedIncarnationId = params.expectedIncarnationId
  if (params.gcIdleTermMin === undefined) {
    return runtime.closeTerminal(
      params.terminal,
      expectedIncarnationId ? { expectedIncarnationId } : undefined
    )
  }
  if (!expectedIncarnationId) {
    throw new Error('gc_close_unverifiable')
  }
  const decision = await evaluateGcIdleClose(
    runtime,
    {
      ...params,
      expectedIncarnationId,
      gcIdleTermMin: params.gcIdleTermMin
    },
    nowMs
  )
  if (!decision.close) {
    throw new Error(`gc_close_refused:${decision.why}`)
  }
  return runtime.closeTerminal(params.terminal, {
    expectedIncarnationId,
    gcIdleTermMin: params.gcIdleTermMin,
    ...(params.gcCoordHandle ? { gcCoordHandle: params.gcCoordHandle } : {})
  })
}

export const TERMINAL_GC_CLOSE_METHOD = defineMethod({
  name: 'terminal.gcClose',
  permission: 'workspace',
  params: TerminalClose,
  handler: async (params, context) => ({
    close: await withTerminalCloseAttribution(
      'terminal.gcClose',
      context,
      'terminal',
      params.terminal,
      () => closeTerminalFromRpc(context.runtime, params)
    )
  })
})
