import { ORCA_LAYOUT_OWNER_IS_MAIN } from '../../../shared/layout-owner-switch'
import type { RuntimeTerminalClose } from '../../../shared/runtime-types'
import type { LayoutApplyReply } from '../../../shared/workspace-layout/workspace-layout-command-types'
import type { WindowLayoutCommand } from '../runtime-layout-apply'
import type { TerminalGcCloseStopOptions } from '../rpc/methods/terminal/terminal-gc-close-stop-fence'
import {
  closeMainOwnedTerminalHandle,
  closeOnOwningPairedHost as closePairedOwnerFirst,
  describeExplicitTerminalClose
} from './explicit-terminal-close-describe'
import {
  OrcaRuntimeWithExplicitCloseTabPtyStops,
  type ExplicitCloseStop
} from './explicit-terminal-close-pty-stops'

export abstract class OrcaRuntimeWithOwnedTerminalClose extends OrcaRuntimeWithExplicitCloseTabPtyStops {
  abstract applyLayoutCommand(command: WindowLayoutCommand): Promise<LayoutApplyReply>

  protected describeTerminalClose(
    handle: string,
    tabId: string,
    ptyId: string | null,
    stop: ExplicitCloseStop
  ): RuntimeTerminalClose {
    return describeExplicitTerminalClose(
      (id) => this.getPtyLivenessVerdict(id),
      handle,
      tabId,
      ptyId,
      stop
    )
  }

  protected async closeMainOwnedTerminal(
    handle: string,
    wholeTab: boolean,
    options?: TerminalGcCloseStopOptions
  ): Promise<RuntimeTerminalClose | null> {
    if (!ORCA_LAYOUT_OWNER_IS_MAIN) {
      return null
    }
    return closeMainOwnedTerminalHandle(
      this,
      {
        ptysById: this.ptysById,
        getLivePtyForHandle: (ownedHandle) => this.getLivePtyForHandle(ownedHandle),
        getLiveLeafForHandle: (ownedHandle) => this.getLiveLeafForHandle(ownedHandle),
        getWorkspaceSessionForWorktree: (worktreeId) =>
          this.getWorkspaceSessionForWorktree(worktreeId) ?? undefined,
        applyLayoutCommand: (command) => this.applyLayoutCommand(command),
        stopExplicitlyClosedTabPtys: (ptyIds, addressedPtyId, capturedIncarnations) =>
          this.stopExplicitlyClosedTabPtys(ptyIds, addressedPtyId, capturedIncarnations),
        describeTerminalClose: (ownedHandle, tabId, ptyId, stop) =>
          this.describeTerminalClose(ownedHandle, tabId, ptyId, stop),
        claudeAgentTeams: {
          removeTeamForLeaderHandle: (ownedHandle) =>
            this.claudeAgentTeams.removeTeamForLeaderHandle(ownedHandle)
        }
      },
      handle,
      wholeTab,
      options
    )
  }

  /** null when this machine owns the PTY; see `closePairedHostLeafFirst` otherwise. */
  protected closeOnOwningPairedHost(
    handle: string,
    leaf: { worktreeId: string; tabId: string; leafId: string; ptyId: string | null },
    method: 'terminal.close' | 'terminal.closeTab',
    closesTab: boolean
  ) {
    return closePairedOwnerFirst(
      {
        callOrchestrationWorkerServer: (environmentId, hostMethod, params, timeoutMs) =>
          this.callOrchestrationWorkerServer(environmentId, hostMethod, params, timeoutMs),
        getWorkspaceSessionHostIdsForTab: (worktreeId, tabId) =>
          this.getWorkspaceSessionHostIdsForTab(worktreeId, tabId),
        store: this.store ?? undefined,
        getLiveLeafForHandle: (ownedHandle) => this.getLiveLeafForHandle(ownedHandle)
      },
      handle,
      leaf,
      method,
      closesTab
    )
  }
}
