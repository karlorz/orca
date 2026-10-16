import { afterEach, describe, expect, it, vi } from 'vitest'
import { ptyIncarnationById } from '../../../../ipc/pty/provider/ownership-state'
import { stopAndWaitPtyFromRuntimeController } from '../../../../ipc/pty/runtime/kill'
import type { PtyRuntimeControllerDeps } from '../../../../ipc/pty/runtime/controller-deps'
import type { ZodType } from 'zod'
import { eraseRpcMethods } from '../../core'
import type {
  RuntimeTerminalClose,
  RuntimeTerminalListResult,
  RuntimeTerminalRead,
  RuntimeTerminalSummary
} from '../../../../../shared/runtime-types'
import { TerminalHandle } from '../../../../../shared/rpc-contract/terminal-unary-params'
import { OrcaRuntimeWithStopExplicitlyClosedTabPtys } from '../../../session-tabs/explicit-terminal-close-stops'
import { TERMINAL_LIFECYCLE_METHODS } from './terminal-lifecycle-methods'
import type { TerminalGcCloseRuntime } from './terminal-gc-close'

const NOW_MS = Date.parse('2026-10-15T08:00:00Z')
const IDLE_OUTPUT_AT = NOW_MS - 3 * 60 * 60 * 1000

function closeMethod(name = 'terminal.close') {
  const method = eraseRpcMethods(TERMINAL_LIFECYCLE_METHODS).find((entry) => entry.name === name)
  if (!method) {
    throw new Error(`${name} is not registered`)
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
  params: Record<string, unknown>,
  methodName = 'terminal.close'
): Promise<{ close: RuntimeTerminalClose }> {
  const method = closeMethod(methodName)
  const parsed = (method.params as ZodType).parse(params)
  return method.handler(parsed, { runtime } as never) as Promise<{ close: RuntimeTerminalClose }>
}

const NOTIFIER_LEAF_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const NOTIFIER_PANE_KEY = `tab-1:${NOTIFIER_LEAF_ID}`

function realCloseHost(state: {
  incarnationId: string
  lastOutputAt: number
  tail: string
  onTabClose?: () => void
  onStopWait?: () => void | Promise<void>
  stopAndWaitResult?: boolean
  tabCloseVia?: 'mobile' | 'notifier'
  providerStartup?: { promise: Promise<void>; onRequested?: () => void }
}): TerminalGcCloseRuntime & {
  stopped: { ptyId: string; incarnationId?: string }[]
  killed: { ptyId: string; incarnationId?: string; expectedIncarnationId?: string }[]
  ptysById: Map<
    string,
    {
      ptyId: string
      incarnationId: string
      lastOutputAt: number
      worktreeId: string
      tabId: string
      paneKey?: string
    }
  >
} {
  const ptysById = new Map<
    string,
    {
      ptyId: string
      incarnationId: string
      lastOutputAt: number
      worktreeId: string
      tabId: string
      paneKey?: string
    }
  >()
  const putPty = (incarnationId: string, lastOutputAt: number) => {
    ptysById.set('pty-1', {
      ptyId: 'pty-1',
      incarnationId,
      lastOutputAt,
      worktreeId: 'wt-1',
      tabId: 'tab-1',
      ...(state.tabCloseVia === 'notifier' ? { paneKey: NOTIFIER_PANE_KEY } : {})
    })
  }
  putPty(state.incarnationId, state.lastOutputAt)
  const stopped: { ptyId: string; incarnationId?: string }[] = []
  const killed: { ptyId: string; incarnationId?: string; expectedIncarnationId?: string }[] = []
  const runtime = Object.create(OrcaRuntimeWithStopExplicitlyClosedTabPtys.prototype) as Record<
    string,
    unknown
  > &
    TerminalGcCloseRuntime & {
      stopped: { ptyId: string; incarnationId?: string }[]
      killed: { ptyId: string; incarnationId?: string; expectedIncarnationId?: string }[]
      ptysById: Map<
        string,
        {
          ptyId: string
          incarnationId: string
          lastOutputAt: number
          worktreeId: string
          tabId: string
          paneKey?: string
        }
      >
    }
  Object.assign(runtime, {
    stopped,
    killed,
    ptysById,
    getRuntimeId: () => 'runtime-test',
    tabs: new Set(['tab-1']),
    notifier: {
      closeTerminalTab: async () => {
        state.onTabClose?.()
        if (state.tabCloseVia === 'notifier') {
          throw new Error('tab_not_found')
        }
      }
    },
    claudeAgentTeams: { removeTeamForLeaderHandle() {} },
    ptyController: {
      async stopAndWait(
        ptyId: string,
        opts?: { expectedIncarnationId?: string; deadlineMs?: number }
      ) {
        if (state.providerStartup) {
          // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: GC close tests only exercise startup/incarnation ports.
          return stopAndWaitPtyFromRuntimeController(
            {
              runtime,
              getLocalPtyProviderStartupPromise: () => {
                state.providerStartup?.onRequested?.()
                return state.providerStartup?.promise
              },
              shutdownProviderAndDetectExit: async () => true,
              finishPtyShutdown: () => opts?.expectedIncarnationId,
              rememberSyntheticKillExit() {},
              sendPtyExitToRenderer() {}
            } as unknown as PtyRuntimeControllerDeps,
            ptyId,
            opts
          )
        }
        await state.onStopWait?.()
        if (
          opts?.expectedIncarnationId &&
          ptysById.get(ptyId)?.incarnationId !== opts.expectedIncarnationId
        ) {
          return false
        }
        stopped.push({ ptyId, incarnationId: ptysById.get(ptyId)?.incarnationId })
        return state.stopAndWaitResult !== false
      },
      kill(ptyId: string, opts?: { expectedIncarnationId?: string }) {
        const live = ptysById.get(ptyId)?.incarnationId
        if (opts?.expectedIncarnationId && live !== opts.expectedIncarnationId) {
          return false
        }
        killed.push({
          ptyId,
          incarnationId: live,
          expectedIncarnationId: opts?.expectedIncarnationId
        })
        return false
      }
    },
    getLivePtyForHandle() {
      const pty = ptysById.get('pty-1')
      return pty ? { record: { tabId: 'tab-1', ptyId: 'pty-1' }, pty } : null
    },
    resolvePtyTabCloseSurfaceAuthority() {
      return state.tabCloseVia === 'notifier'
        ? null
        : { surface: { tab: { parentTabId: 'tab-1', leafId: 'leaf-1' } } }
    },
    findMobileTerminalSurface: () => null,
    getMobileTerminalLeafPtyIds: () => [],
    resolveTerminalCloseTarget: () => 'last-pane',
    getPtyIdsForExplicitTabClose: () => ['pty-1'],
    async closeMobileSessionTab() {
      state.onTabClose?.()
    },
    notifyRendererOfHeadlessTerminalClose() {},
    markPtyStopRequested() {},
    markPtyLivenessUnverifiable() {},
    getPtyLivenessVerdict: () => ({ status: 'exited' }),
    async listTerminals() {
      return listed(
        summary({ incarnationId: state.incarnationId, lastOutputAt: state.lastOutputAt })
      )
    },
    async readTerminal(): Promise<RuntimeTerminalRead> {
      return {
        handle: 'term_idle',
        status: 'running',
        tail: state.tail ? [state.tail] : [],
        truncated: false,
        nextCursor: null
      }
    }
  })
  return runtime
}

describe('terminal.close GC idle fence', () => {
  afterEach(() => {
    ptyIncarnationById.delete('pty-1')
  })

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

  it('does not stop a replacement PTY that appears during awaited tab close', async () => {
    const runtimeState = {
      incarnationId: 'inc-old',
      lastOutputAt: IDLE_OUTPUT_AT,
      tail: '',
      onTabClose: () => {
        runtimeState.incarnationId = 'inc-new'
        runtime.ptysById.set('pty-1', {
          ptyId: 'pty-1',
          incarnationId: 'inc-new',
          lastOutputAt: Date.now(),
          worktreeId: 'wt-1',
          tabId: 'tab-1'
        })
      }
    }
    const runtime = realCloseHost(runtimeState)
    await expect(
      callRegisteredClose(runtime, {
        terminal: 'term_idle',
        expectedIncarnationId: 'inc-old',
        gcIdleTermMin: 60
      })
    ).rejects.toThrow('gc_close_refused:incarnation-changed')
    expect(runtime.stopped).toEqual([])
  })

  it('does not stop when same-incarnation activity resumes during awaited tab close', async () => {
    const runtimeState = {
      incarnationId: 'inc-old',
      lastOutputAt: IDLE_OUTPUT_AT,
      tail: '',
      onTabClose: () => {
        runtimeState.lastOutputAt = Date.now()
        runtimeState.tail = 'Thinking'
        runtime.ptysById.set('pty-1', {
          ptyId: 'pty-1',
          incarnationId: 'inc-old',
          lastOutputAt: Date.now(),
          worktreeId: 'wt-1',
          tabId: 'tab-1'
        })
      }
    }
    const runtime = realCloseHost(runtimeState)
    await expect(
      callRegisteredClose(runtime, {
        terminal: 'term_idle',
        expectedIncarnationId: 'inc-old',
        gcIdleTermMin: 60
      })
    ).rejects.toThrow(/gc_close_refused:(busy|recent-output)/)
    expect(runtime.stopped).toEqual([])
  })

  it('does not stop a replacement after notifier tab_not_found', async () => {
    const runtimeState = {
      incarnationId: 'inc-old',
      lastOutputAt: IDLE_OUTPUT_AT,
      tail: '',
      tabCloseVia: 'notifier' as const,
      onTabClose: () => {
        runtimeState.incarnationId = 'inc-new'
        runtime.ptysById.set('pty-1', {
          ptyId: 'pty-1',
          incarnationId: 'inc-new',
          lastOutputAt: Date.now(),
          worktreeId: 'wt-1',
          tabId: 'tab-1',
          paneKey: NOTIFIER_PANE_KEY
        })
      }
    }
    const runtime = realCloseHost(runtimeState)
    await expect(
      callRegisteredClose(
        runtime,
        {
          terminal: 'term_idle',
          expectedIncarnationId: 'inc-old',
          gcIdleTermMin: 60
        },
        'terminal.gcClose'
      )
    ).rejects.toThrow('gc_close_refused:incarnation-changed')
    expect(runtime.stopped).toEqual([])
    expect(runtime.killed).toEqual([])
  })

  it('does not stop resumed activity after notifier tab_not_found', async () => {
    const runtimeState = {
      incarnationId: 'inc-old',
      lastOutputAt: IDLE_OUTPUT_AT,
      tail: '',
      tabCloseVia: 'notifier' as const,
      onTabClose: () => {
        runtimeState.lastOutputAt = Date.now()
        runtimeState.tail = 'Thinking'
        runtime.ptysById.set('pty-1', {
          ptyId: 'pty-1',
          incarnationId: 'inc-old',
          lastOutputAt: Date.now(),
          worktreeId: 'wt-1',
          tabId: 'tab-1',
          paneKey: NOTIFIER_PANE_KEY
        })
      }
    }
    const runtime = realCloseHost(runtimeState)
    await expect(
      callRegisteredClose(
        runtime,
        {
          terminal: 'term_idle',
          expectedIncarnationId: 'inc-old',
          gcIdleTermMin: 60
        },
        'terminal.gcClose'
      )
    ).rejects.toThrow(/gc_close_refused:(busy|recent-output)/)
    expect(runtime.stopped).toEqual([])
    expect(runtime.killed).toEqual([])
  })

  it('does not kill a replacement that appears while stopAndWait is pending', async () => {
    const runtimeState = {
      incarnationId: 'inc-old',
      lastOutputAt: IDLE_OUTPUT_AT,
      tail: '',
      stopAndWaitResult: false,
      onStopWait: () => {
        runtimeState.incarnationId = 'inc-new'
        runtime.ptysById.set('pty-1', {
          ptyId: 'pty-1',
          incarnationId: 'inc-new',
          lastOutputAt: Date.now(),
          worktreeId: 'wt-1',
          tabId: 'tab-1'
        })
      }
    }
    const runtime = realCloseHost(runtimeState)
    await expect(
      callRegisteredClose(
        runtime,
        {
          terminal: 'term_idle',
          expectedIncarnationId: 'inc-old',
          gcIdleTermMin: 60
        },
        'terminal.gcClose'
      )
    ).rejects.toThrow('terminal_handle_stale')
    expect(runtime.stopped).toEqual([])
    expect(runtime.killed).toEqual([])
  })

  it('does not select a replacement provider after startup', async () => {
    let resumeStartup: (() => void) | undefined
    let sawStartup = false
    const startup = new Promise<void>((resolve) => {
      resumeStartup = resolve
    })
    const runtimeState = {
      incarnationId: 'inc-old',
      lastOutputAt: IDLE_OUTPUT_AT,
      tail: '',
      providerStartup: {
        promise: startup,
        onRequested: () => {
          sawStartup = true
        }
      }
    }
    const runtime = realCloseHost(runtimeState)
    ptyIncarnationById.set('pty-1', 'inc-old')
    const pending = callRegisteredClose(
      runtime,
      {
        terminal: 'term_idle',
        expectedIncarnationId: 'inc-old',
        gcIdleTermMin: 60
      },
      'terminal.gcClose'
    )
    await vi.waitFor(() => {
      expect(sawStartup).toBe(true)
    })
    runtimeState.incarnationId = 'inc-new'
    runtime.ptysById.set('pty-1', {
      ptyId: 'pty-1',
      incarnationId: 'inc-new',
      lastOutputAt: Date.now(),
      worktreeId: 'wt-1',
      tabId: 'tab-1'
    })
    ptyIncarnationById.set('pty-1', 'inc-new')
    resumeStartup?.()
    await expect(pending).rejects.toThrow('terminal_handle_stale')
    expect(runtime.stopped).toEqual([])
    expect(runtime.killed).toEqual([])
  })

  it('older hosts strip GC fields from terminal.close and do not implement gcClose', () => {
    const stripped = TerminalHandle.parse({
      terminal: 'term_idle',
      expectedIncarnationId: 'inc-old',
      gcIdleTermMin: 60,
      gcCoordHandle: 'term_coord'
    })
    expect(stripped).toEqual({ terminal: 'term_idle', expectedIncarnationId: 'inc-old' })
    expect(
      eraseRpcMethods(TERMINAL_LIFECYCLE_METHODS).some((entry) => entry.name === 'terminal.gcClose')
    ).toBe(true)
    expect(closeMethod('terminal.gcClose').name).toBe('terminal.gcClose')
  })
})
