import { describe, expect, it } from 'vitest'
import type { ZodType } from 'zod'
import { eraseRpcMethods } from '../../core'
import type {
  RuntimeTerminalClose,
  RuntimeTerminalListResult,
  RuntimeTerminalRead,
  RuntimeTerminalSummary
} from '../../../../../shared/runtime-types'
import { TERMINAL_LIFECYCLE_METHODS } from './terminal-lifecycle-methods'
import type { TerminalGcCloseRuntime } from './terminal-gc-close'

const NOW_MS = Date.parse('2026-10-15T08:00:00Z')
const IDLE_OUTPUT_AT = NOW_MS - 3 * 60 * 60 * 1000

function closeMethod() {
  const method = eraseRpcMethods(TERMINAL_LIFECYCLE_METHODS).find(
    (entry) => entry.name === 'terminal.close'
  )
  if (!method) {
    throw new Error('terminal.close is not registered')
  }
  return method
}

function summary(
  overrides: Partial<RuntimeTerminalSummary> &
    Pick<RuntimeTerminalSummary, 'incarnationId' | 'lastOutputAt'>
): RuntimeTerminalSummary {
  return {
    handle: 'term_idle',
    ptyId: 'pty-1',
    worktreeId: 'wt-1',
    worktreePath: '/repo',
    branch: 'main',
    tabId: 'tab-1',
    leafId: 'leaf-1',
    title: 'idle',
    connected: true,
    writable: true,
    preview: '',
    ...overrides
  }
}

function listed(row: RuntimeTerminalSummary): RuntimeTerminalListResult {
  return {
    terminals: [row],
    totalCount: 1,
    truncated: false,
    hostScope: { hostIds: ['local'], omittedHostIds: [] }
  }
}

function hostRuntime(state: {
  incarnationId: string
  lastOutputAt: number
  tail: string
  onRead?: () => void
}): TerminalGcCloseRuntime & { closed: { handle: string; expectedIncarnationId?: string }[] } {
  const closed: { handle: string; expectedIncarnationId?: string }[] = []
  const runtime: TerminalGcCloseRuntime & {
    closed: { handle: string; expectedIncarnationId?: string }[]
    getRuntimeId: () => string
  } = {
    closed,
    getRuntimeId: () => 'runtime-test',
    async listTerminals() {
      return listed(
        summary({ incarnationId: state.incarnationId, lastOutputAt: state.lastOutputAt })
      )
    },
    async readTerminal(): Promise<RuntimeTerminalRead> {
      state.onRead?.()
      return {
        handle: 'term_idle',
        status: 'running',
        tail: state.tail ? [state.tail] : [],
        truncated: false,
        nextCursor: null
      }
    },
    async closeTerminal(handle, options): Promise<RuntimeTerminalClose> {
      if (options?.expectedIncarnationId && options.expectedIncarnationId !== state.incarnationId) {
        throw new Error('terminal_handle_stale')
      }
      closed.push({ handle, expectedIncarnationId: options?.expectedIncarnationId })
      return { handle, tabId: 'tab-1', ptyKilled: true }
    }
  }
  return runtime
}

async function callRegisteredClose(
  runtime: TerminalGcCloseRuntime,
  params: Record<string, unknown>
): Promise<{ close: RuntimeTerminalClose }> {
  const method = closeMethod()
  const parsed = (method.params as ZodType).parse(params)
  return method.handler(parsed, { runtime } as never) as Promise<{ close: RuntimeTerminalClose }>
}

describe('terminal.close GC idle fence', () => {
  it('does not close a replacement incarnation that appears during re-read', async () => {
    const runtimeState = {
      incarnationId: 'inc-old',
      lastOutputAt: IDLE_OUTPUT_AT,
      tail: '',
      onRead: () => {
        runtimeState.incarnationId = 'inc-new'
        runtimeState.tail = 'new task started'
      }
    }
    const host = hostRuntime(runtimeState)
    await expect(
      callRegisteredClose(host, {
        terminal: 'term_idle',
        expectedIncarnationId: 'inc-old',
        gcIdleTermMin: 60
      })
    ).rejects.toThrow('gc_close_refused:incarnation-changed')
    expect(host.closed).toEqual([])
  })

  it('does not close when activity resumes before the host close', async () => {
    const runtimeState = {
      incarnationId: 'inc-old',
      lastOutputAt: IDLE_OUTPUT_AT,
      tail: '',
      onRead: () => {
        runtimeState.lastOutputAt = Date.now()
        runtimeState.tail = 'Thinking'
      }
    }
    const host = hostRuntime(runtimeState)
    await expect(
      callRegisteredClose(host, {
        terminal: 'term_idle',
        expectedIncarnationId: 'inc-old',
        gcIdleTermMin: 60
      })
    ).rejects.toThrow(/gc_close_refused:(busy|recent-output)/)
    expect(host.closed).toEqual([])
  })

  it('closes only after the host confirms incarnation and idle', async () => {
    const host = hostRuntime({
      incarnationId: 'inc-old',
      lastOutputAt: IDLE_OUTPUT_AT,
      tail: ''
    })
    await expect(
      callRegisteredClose(host, {
        terminal: 'term_idle',
        expectedIncarnationId: 'inc-old',
        gcIdleTermMin: 60
      })
    ).resolves.toEqual({ close: { handle: 'term_idle', tabId: 'tab-1', ptyKilled: true } })
    expect(host.closed).toEqual([{ handle: 'term_idle', expectedIncarnationId: 'inc-old' }])
  })

  it('ordinary close still omits the GC idle fence', async () => {
    const host = hostRuntime({
      incarnationId: 'inc-new',
      lastOutputAt: NOW_MS,
      tail: 'Thinking'
    })
    await expect(callRegisteredClose(host, { terminal: 'term_idle' })).resolves.toMatchObject({
      close: { handle: 'term_idle', ptyKilled: true }
    })
    expect(host.closed).toEqual([{ handle: 'term_idle', expectedIncarnationId: undefined }])
  })

  it('refuses GC close when the host cannot see an expected incarnation', async () => {
    const host = hostRuntime({
      incarnationId: 'inc-old',
      lastOutputAt: IDLE_OUTPUT_AT,
      tail: ''
    })
    await expect(
      callRegisteredClose(host, { terminal: 'term_idle', gcIdleTermMin: 60 })
    ).rejects.toThrow('gc_close_unverifiable')
    expect(host.closed).toEqual([])
  })
})
