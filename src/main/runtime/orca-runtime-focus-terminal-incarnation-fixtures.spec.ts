import './orca-runtime-test-lifecycle.spec'
import type { TerminalPaneLayoutNode } from '../../shared/terminal-tab-types'
import type { RuntimeStore } from './runtime-store-contract'
import { vi } from 'vitest'
import { createMobileCreateTestNotifier } from './orca-runtime-test-scenario-builders.spec'
import { OrcaRuntimeService } from './orca-runtime-test-mocks.spec'
import {
  HEADLESS_LEAF_ID,
  TEST_WORKTREE_ID,
  makeRuntimeStoreWithWorkspaceSession,
  makeWorkspaceSessionWithHeadlessTerminal
} from './orca-runtime-test-fixtures.spec'

// Why: the focus-path regressions share these graph fixtures; keeping them here holds the test
// file under the max-lines limit without dropping a case.
export const TAB_ID = 'host-tab'
export const PTY_ID = 'incarnation-pty'
export const INCARNATION_ID = '11111111-1111-4111-8111-aaaaaaaaaaaa'
export const REPLACEMENT_INCARNATION_ID = '22222222-2222-4222-8222-bbbbbbbbbbbb'
export const LAUNCH_TOKEN = 'launch-token-incarnation'
export const PANE_KEY = `${TAB_ID}:${HEADLESS_LEAF_ID}`
export const WORKTREE_ID = TEST_WORKTREE_ID

/**
 * The runtime-owned PTY record, mirroring the fields the owner resolver and the
 * focus path read. Typed locally so the test never falls back to a broad `any`.
 */
export type OwnerPtyRecord = {
  ptyId: string
  worktreeId: string
  connected: boolean
  connectionId: string | null
  isWsl: boolean | null
  incarnationId: string | null
  launchToken: string | null
  launchIncarnationId: string | null
  tabId: string | null
  paneKey: string | null
}

export type LeafRecord = {
  tabId: string
  leafId: string
  worktreeId: string
  ptyId: string | null
  ptyGeneration: number
}

export type OwnerRecord = {
  handle: string
  runtimeId: string
  executionHostId: string
  ptyId: string
  incarnationId: string
  paneKey: string
  tabId: string
  leafId: string
  worktreeId: string
  launchToken: string
}

export type FocusPathInternals = {
  ptysById: Map<string, OwnerPtyRecord>
  handles: Map<
    string,
    {
      handle: string
      runtimeId: string
      rendererGraphEpoch: number
      worktreeId: string
      tabId: string
      leafId: string
      ptyId: string | null
      ptyGeneration: number
    }
  >
  leaves: Map<string, LeafRecord>
  handleByLeafKey: Map<string, string>
  rendererGraphEpoch: number
  issueHandle: (leaf: LeafRecord) => string
  resolveHandleForTab: (tabId: string) => string | null
  getSessionTerminalOwner: (paneKey: string) => OwnerRecord | null
}

export function focusPathInternals(runtime: OrcaRuntimeService): FocusPathInternals {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Test seam reads runtime-owned PTY records through the linear mixin chain, whose base type does not expose them.
  return runtime as unknown as FocusPathInternals
}

export function asOwnerBinding(owner: OwnerRecord): {
  runtimeId: string
  executionHostId: string
  handle: string
  ptyId: string
  incarnationId: string
  paneKey: string
  tabId: string
  leafId: string
  worktreeId: string
  provider: 'grok'
  sessionId: string
  boundaryAt: number
} {
  // GrokSessionBinding omits the owner-only `launchToken` field; keep that
  // omission explicit rather than passing an excess property.
  const { launchToken: _launchToken, ...rest } = owner
  return { ...rest, provider: 'grok', sessionId: 'session', boundaryAt: 1 }
}

export function makeOwnerRuntime(): {
  runtime: OrcaRuntimeService
  focusTerminal: ReturnType<typeof vi.fn>
  revealTerminalSession: ReturnType<typeof vi.fn>
} {
  const session = makeWorkspaceSessionWithHeadlessTerminal()
  const { runtimeStore } = makeRuntimeStoreWithWorkspaceSession(session)
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The shared fixture implements RuntimeStore; its legacy Mock return type loses callable signatures.
  const runtime = new OrcaRuntimeService(runtimeStore as RuntimeStore)
  runtime.attachWindow(1)
  runtime.syncWindowGraph(1, { tabs: [], leaves: [] })

  const focusTerminal = vi.fn()
  const revealTerminalSession = vi.fn().mockResolvedValue({
    tabId: TAB_ID,
    identity: { worktreeId: WORKTREE_ID, tabId: TAB_ID, leafId: HEADLESS_LEAF_ID, ptyId: PTY_ID },
    windowFocused: false,
    paneFocused: false
  })
  const notifier = createMobileCreateTestNotifier(vi.fn())
  runtime.setNotifier({ ...notifier, focusTerminal, revealTerminalSession })

  runtime.registerPty(PTY_ID, WORKTREE_ID, null, {
    tabId: TAB_ID,
    leafId: HEADLESS_LEAF_ID,
    incarnationId: INCARNATION_ID,
    agentLaunchAuthority: { launchToken: LAUNCH_TOKEN, launchAgent: 'grok' }
  })

  const pty = focusPathInternals(runtime).ptysById.get(PTY_ID)
  if (!pty) {
    throw new Error('expected registered PTY record')
  }
  return { runtime, focusTerminal, revealTerminalSession }
}

export const RENDERER_TAB_ID = 'renderer-tab'
export const RENDERER_LEAF_ID = '33333333-3333-4333-8333-cccccccccccc'
export const RENDERER_PANE_KEY = `${RENDERER_TAB_ID}:${RENDERER_LEAF_ID}`
export const RENDERER_PTY_ID = 'renderer-pty'
export const RENDERER_INCARNATION_ID = '44444444-4444-4444-8444-dddddddddddd'
export const RETAINED_HANDLE = 'term_retained_renderer'

export function makeRetainedHandleRuntime(): {
  runtime: OrcaRuntimeService
  focusTerminal: ReturnType<typeof vi.fn>
  revealTerminalSession: ReturnType<typeof vi.fn>
  createTerminal: ReturnType<typeof vi.fn>
  writes: string[]
  activations: string[]
  setOnDeferredMutation: (callback: () => void) => void
  handle: string
} {
  const session = makeWorkspaceSessionWithHeadlessTerminal()
  const { runtimeStore } = makeRuntimeStoreWithWorkspaceSession(session)
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The shared fixture implements RuntimeStore; its legacy Mock return type loses callable signatures.
  const runtime = new OrcaRuntimeService(runtimeStore as RuntimeStore)
  runtime.attachWindow(1)

  runtime.registerPty(RENDERER_PTY_ID, WORKTREE_ID, null, {
    tabId: RENDERER_TAB_ID,
    leafId: RENDERER_LEAF_ID,
    incarnationId: RENDERER_INCARNATION_ID,
    agentLaunchAuthority: { launchToken: LAUNCH_TOKEN, launchAgent: 'grok' }
  })
  runtime.syncWindowGraph(1, {
    tabs: [
      {
        tabId: RENDERER_TAB_ID,
        worktreeId: WORKTREE_ID,
        title: 'Retained Renderer Terminal',
        activeLeafId: RENDERER_LEAF_ID,
        layout: { type: 'leaf', leafId: RENDERER_LEAF_ID } satisfies TerminalPaneLayoutNode
      }
    ],
    leaves: [
      {
        tabId: RENDERER_TAB_ID,
        worktreeId: WORKTREE_ID,
        leafId: RENDERER_LEAF_ID,
        paneRuntimeId: 1,
        ptyId: RENDERER_PTY_ID
      }
    ]
  })

  const writes: string[] = []
  runtime.setPtyController({
    spawn: vi.fn().mockResolvedValue({ id: RENDERER_PTY_ID }),
    write: (_ptyId: string, data: string) => {
      writes.push(data)
      return true
    },
    kill: () => true,
    getForegroundProcess: async () => null
  })

  let onDeferredMutation: (() => void) | null = null
  const activations: string[] = []
  const focusTerminal = vi.fn()
  const createTerminal = vi.fn()
  const revealTerminalSession = vi.fn(
    async (
      _worktreeId: string,
      opts: { canFocusExistingSession?: () => boolean; activateHostWindow?: boolean }
    ) => {
      // Mirrors the main process: validate before send, then again after the renderer reply and
      // before OS activation. Activation is only recorded once the second check passes.
      if (opts.canFocusExistingSession && !opts.canFocusExistingSession()) {
        throw new Error('session_navigation_unverifiable')
      }
      onDeferredMutation?.()
      if (opts.canFocusExistingSession && !opts.canFocusExistingSession()) {
        throw new Error('session_navigation_unverifiable')
      }
      if (opts.activateHostWindow === true) {
        activations.push(WORKTREE_ID)
      }
      return {
        tabId: RENDERER_TAB_ID,
        identity: {
          worktreeId: WORKTREE_ID,
          tabId: RENDERER_TAB_ID,
          leafId: RENDERER_LEAF_ID,
          ptyId: RENDERER_PTY_ID
        },
        windowFocused: true,
        paneFocused: true
      }
    }
  )
  const notifier = createMobileCreateTestNotifier(vi.fn())
  runtime.setNotifier({ ...notifier, focusTerminal, createTerminal, revealTerminalSession })

  const leaf = [...focusPathInternals(runtime).leaves.values()].find(
    (candidate) => candidate.tabId === RENDERER_TAB_ID
  )
  if (!leaf) {
    throw new Error('expected renderer leaf record')
  }
  // A retained renderer handle: the record names the renderer tab, and its PTY carries the same
  // tab/leaf, which is what an adopted renderer tab looks like to the runtime.
  focusPathInternals(runtime).handles.set(RETAINED_HANDLE, {
    handle: RETAINED_HANDLE,
    runtimeId: runtime.getRuntimeId(),
    rendererGraphEpoch: focusPathInternals(runtime).rendererGraphEpoch,
    worktreeId: WORKTREE_ID,
    tabId: RENDERER_TAB_ID,
    leafId: RENDERER_LEAF_ID,
    ptyId: RENDERER_PTY_ID,
    ptyGeneration: 0
  })
  focusPathInternals(runtime).handleByLeafKey.set(
    `${RENDERER_TAB_ID}:${RENDERER_LEAF_ID}`,
    RETAINED_HANDLE
  )

  return {
    runtime,
    focusTerminal,
    revealTerminalSession,
    createTerminal,
    writes,
    activations,
    setOnDeferredMutation: (callback: () => void) => {
      onDeferredMutation = callback
    },
    handle: RETAINED_HANDLE
  }
}

export const ADOPTED_TAB_ID = 'adopted-renderer-tab'
export const ADOPTED_LEAF_ID = '55555555-5555-4555-8555-eeeeeeeeeeee'
export const ADOPTED_SPLIT_LEAF_ID = '66666666-6666-4666-8666-ffffffffffff'
export const ADOPTED_PANE_KEY = `${ADOPTED_TAB_ID}:${ADOPTED_LEAF_ID}`
export const ADOPTED_SPLIT_PANE_KEY = `${ADOPTED_TAB_ID}:${ADOPTED_SPLIT_LEAF_ID}`

export function makeAdoptedOwnerRuntime(options: { split?: boolean } = {}): {
  runtime: OrcaRuntimeService
  focusTerminal: ReturnType<typeof vi.fn>
  revealTerminalSession: ReturnType<typeof vi.fn>
  createTerminal: ReturnType<typeof vi.fn>
  writes: string[]
  activations: string[]
  setOnDeferredMutation: (callback: () => void) => void
  retainedHandle: string
} {
  const session = makeWorkspaceSessionWithHeadlessTerminal()
  const { runtimeStore } = makeRuntimeStoreWithWorkspaceSession(session)
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The shared fixture implements RuntimeStore; its legacy Mock return type loses callable signatures.
  const runtime = new OrcaRuntimeService(runtimeStore as RuntimeStore)
  runtime.attachWindow(1)

  // The PTY is live first; the renderer then adopts it under its own tab, exactly as an
  // adopted existing tab arrives over the CLI.
  runtime.registerPty(PTY_ID, WORKTREE_ID, null, {
    tabId: ADOPTED_TAB_ID,
    leafId: ADOPTED_LEAF_ID,
    incarnationId: INCARNATION_ID,
    agentLaunchAuthority: { launchToken: LAUNCH_TOKEN, launchAgent: 'grok' }
  })
  runtime.syncWindowGraph(1, {
    tabs: [
      {
        tabId: ADOPTED_TAB_ID,
        worktreeId: WORKTREE_ID,
        title: 'Adopted Renderer Terminal',
        activeLeafId: ADOPTED_LEAF_ID,
        layout: { type: 'leaf', leafId: ADOPTED_LEAF_ID } satisfies TerminalPaneLayoutNode
      }
    ],
    leaves: [
      {
        tabId: ADOPTED_TAB_ID,
        worktreeId: WORKTREE_ID,
        leafId: ADOPTED_LEAF_ID,
        paneRuntimeId: 1,
        ptyId: PTY_ID
      },
      ...(options.split
        ? [
            {
              tabId: ADOPTED_TAB_ID,
              worktreeId: WORKTREE_ID,
              leafId: ADOPTED_SPLIT_LEAF_ID,
              paneRuntimeId: 2,
              ptyId: null
            }
          ]
        : [])
    ]
  })

  const writes: string[] = []
  runtime.setPtyController({
    spawn: vi.fn().mockResolvedValue({ id: PTY_ID }),
    write: (_ptyId: string, data: string) => {
      writes.push(data)
      return true
    },
    kill: () => true,
    getForegroundProcess: async () => null
  })

  let onDeferredMutation: (() => void) | null = null
  const activations: string[] = []
  const focusTerminal = vi.fn()
  const createTerminal = vi.fn()
  const revealTerminalSession = vi.fn(
    async (
      _worktreeId: string,
      opts: { canFocusExistingSession?: () => boolean; activateHostWindow?: boolean }
    ) => {
      // Mirrors the main process: validate before send, then again after the renderer reply and
      // before OS activation. Activation is recorded only once the second check passes.
      if (opts.canFocusExistingSession && !opts.canFocusExistingSession()) {
        throw new Error('session_navigation_unverifiable')
      }
      onDeferredMutation?.()
      if (opts.canFocusExistingSession && !opts.canFocusExistingSession()) {
        throw new Error('session_navigation_unverifiable')
      }
      if (opts.activateHostWindow === true) {
        activations.push(WORKTREE_ID)
      }
      return {
        tabId: ADOPTED_TAB_ID,
        identity: {
          worktreeId: WORKTREE_ID,
          tabId: ADOPTED_TAB_ID,
          leafId: ADOPTED_LEAF_ID,
          ptyId: PTY_ID
        },
        windowFocused: false,
        paneFocused: true
      }
    }
  )
  const notifier = createMobileCreateTestNotifier(vi.fn())
  runtime.setNotifier({ ...notifier, focusTerminal, createTerminal, revealTerminalSession })

  const retainedHandle = focusPathInternals(runtime).resolveHandleForTab(ADOPTED_TAB_ID)
  if (!retainedHandle) {
    throw new Error('expected the renderer tab to retain a handle')
  }
  return {
    runtime,
    focusTerminal,
    revealTerminalSession,
    createTerminal,
    writes,
    activations,
    setOnDeferredMutation: (callback: () => void) => {
      onDeferredMutation = callback
    },
    retainedHandle
  }
}
