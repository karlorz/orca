import type { RuntimeTerminalClose } from '../../../shared/runtime-types'
import type { PtyLivenessVerdict } from '../../../shared/pty-liveness-verdict'
import type { WorkspaceSessionState } from '../../../shared/workspace-session-state-types'
import type { ExplicitCloseStop } from './explicit-terminal-close-pty-stops'
import {
  closePairedHostLeafFirst,
  isTerminalTabPinnedInSession
} from './paired-host-terminal-close'
import type { LayoutApplyReply } from '../../../shared/workspace-layout/workspace-layout-command-types'
import type { WindowLayoutCommand } from '../runtime-layout-apply'
import {
  capturePtyIncarnationIds,
  finishGuardedPtyStop,
  type TerminalGcCloseStopOptions
} from '../rpc/methods/terminal/terminal-gc-close-stop-fence'
import { closeMainOwnedPaneByHandle, type MainHandleCloseHost } from './main-handle-close'
import type { SurfacesOwner } from '../terminal/surface/main-terminal-surfaces'

export function describeExplicitTerminalClose(
  getPtyLivenessVerdict: (ptyId: string) => PtyLivenessVerdict | null,
  handle: string,
  tabId: string,
  ptyId: string | null,
  stop: ExplicitCloseStop
): RuntimeTerminalClose {
  const close: RuntimeTerminalClose = { handle, tabId, ptyKilled: stop.stopped }
  if (stop.stopped || !ptyId) {
    return close
  }
  const verdict = getPtyLivenessVerdict(ptyId)
  if (verdict?.status === 'unverifiable') {
    return { ...close, ptyStopVerdict: 'unverifiable', ptyStopReason: verdict.reason }
  }
  if (verdict?.status === 'live') {
    return { ...close, ptyStopVerdict: 'live' }
  }
  return close
}

export type ExplicitMainOwnedCloseRuntime = {
  ptysById: {
    get(id: string): { incarnationId?: string | null } | undefined
    keys(): Iterable<string>
  }
  getLivePtyForHandle: (handle: string) => { pty: { ptyId: string; worktreeId: string } } | null
  getLiveLeafForHandle: (handle: string) => {
    leaf: { worktreeId: string; tabId: string; leafId: string; ptyId: string | null }
  }
  getWorkspaceSessionForWorktree: (
    worktreeId: string
  ) => { remoteSessionIdsByTabId?: Record<string, string | undefined> } | undefined
  applyLayoutCommand: (command: WindowLayoutCommand) => Promise<LayoutApplyReply>
  stopExplicitlyClosedTabPtys: (
    ptyIds: readonly string[],
    addressedPtyId: string,
    capturedIncarnations?: ReadonlyMap<string, string>
  ) => Promise<ExplicitCloseStop>
  describeTerminalClose: (
    handle: string,
    tabId: string,
    ptyId: string | null,
    stop: ExplicitCloseStop
  ) => RuntimeTerminalClose
  claudeAgentTeams: { removeTeamForLeaderHandle: (handle: string) => void }
}

export async function closeMainOwnedTerminalHandle(
  surfacesOwner: SurfacesOwner,
  runtime: ExplicitMainOwnedCloseRuntime,
  handle: string,
  wholeTab: boolean,
  options?: TerminalGcCloseStopOptions
): Promise<RuntimeTerminalClose | null> {
  const captured = capturePtyIncarnationIds(runtime.ptysById, [...runtime.ptysById.keys()])
  const host: MainHandleCloseHost = {
    runtime: surfacesOwner,
    livePty: () => runtime.getLivePtyForHandle(handle)?.pty ?? null,
    liveLeaf: () => runtime.getLiveLeafForHandle(handle).leaf,
    remoteSessionIdOf: (worktreeId, tabId) =>
      runtime.getWorkspaceSessionForWorktree(worktreeId)?.remoteSessionIdsByTabId?.[tabId],
    applyLayoutCommand: (command) => runtime.applyLayoutCommand(command),
    stop: (ptyIds, addressed) =>
      finishGuardedPtyStop(
        {
          ptysById: runtime.ptysById,
          stopExplicitlyClosedTabPtys: (ids, ptyId, incarnations) =>
            runtime.stopExplicitlyClosedTabPtys(ids, ptyId, incarnations)
        },
        handle,
        ptyIds,
        addressed,
        captured,
        options
      ),
    describe: (...args) => runtime.describeTerminalClose(...args)
  }
  const result = await closeMainOwnedPaneByHandle(host, handle, wholeTab)
  if (result) {
    runtime.claudeAgentTeams.removeTeamForLeaderHandle(handle)
  }
  return result
}

export type ExplicitPairedHostCloseRuntime = {
  callOrchestrationWorkerServer: (
    environmentId: string,
    method: 'terminal.close' | 'terminal.closeTab',
    params: { terminal: string },
    timeoutMs: number
  ) => Promise<unknown>
  getWorkspaceSessionHostIdsForTab: (worktreeId: string, tabId: string) => string[]
  store?: {
    getWorkspaceSession?: (hostId: string) => WorkspaceSessionState | null | undefined
  }
  getLiveLeafForHandle: (handle: string) => {
    leaf: { worktreeId: string; tabId: string; leafId: string; ptyId: string | null }
  }
}

export function closeOnOwningPairedHost(
  runtime: ExplicitPairedHostCloseRuntime,
  handle: string,
  leaf: { worktreeId: string; tabId: string; leafId: string; ptyId: string | null },
  method: 'terminal.close' | 'terminal.closeTab',
  closesTab: boolean
): ReturnType<typeof closePairedHostLeafFirst> {
  return closePairedHostLeafFirst(leaf, method, {
    call: (environmentId, hostMethod, params, timeoutMs) =>
      runtime.callOrchestrationWorkerServer(environmentId, hostMethod, params, timeoutMs),
    isTabPinned: () =>
      closesTab &&
      runtime
        .getWorkspaceSessionHostIdsForTab(leaf.worktreeId, leaf.tabId)
        .some((hostId) =>
          isTerminalTabPinnedInSession(runtime.store?.getWorkspaceSession?.(hostId), leaf)
        ),
    readBoundLeaf: () => runtime.getLiveLeafForHandle(handle).leaf
  })
}
