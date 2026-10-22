import { ORCA_LAYOUT_OWNER_IS_MAIN } from '../../../shared/layout-owner-switch'
import type { LayoutApplyReply } from '../../../shared/workspace-layout/workspace-layout-command-types'
import type { WindowLayoutCommand } from '../runtime-layout-apply'
import { closeMainOwnedPaneByHandle } from './main-handle-close'
import type { RuntimeTerminalClose } from '../../../shared/runtime-types'
import {
  capturePtyIncarnationIds,
  finishGuardedPtyStop,
  type TerminalGcCloseStopOptions
} from '../rpc/methods/terminal/terminal-gc-close-stop-fence'
import type { WorktreePtyHostFence } from '../worktree-pty-host-fence'
import { OrcaRuntimeWithFocusTerminal } from '../terminal/focus/focus-terminal'
import { EXPLICIT_TERMINAL_CLOSE_STOP_TIMEOUT_MS } from '../orca-runtime-core'
import { SSH_PROVIDER_UNREGISTERED_REASON } from '../../../shared/pty-liveness-verdict'
import { errorMessage } from '../../../shared/error-message'
import type { ResolvedWorktree } from '../runtime-worktree-path-identity'

/** How an explicit close's stop of its addressed PTY ended. */
export type ExplicitCloseStop = { stopped: boolean }

export const EXPLICIT_CLOSE_NO_STOP: ExplicitCloseStop = { stopped: false }

export abstract class OrcaRuntimeWithStopExplicitlyClosedTabPtys extends OrcaRuntimeWithFocusTerminal {
  protected abstract describeTerminalClose(
    handle: string,
    tabId: string,
    ptyId: string | null,
    stop: ExplicitCloseStop
  ): RuntimeTerminalClose

  abstract applyLayoutCommand(command: WindowLayoutCommand): Promise<LayoutApplyReply>

  protected async closeMainOwnedTerminal(
    handle: string,
    wholeTab: boolean,
    options?: TerminalGcCloseStopOptions
  ): Promise<RuntimeTerminalClose | null> {
    if (!ORCA_LAYOUT_OWNER_IS_MAIN) {
      return null
    }
    const captured = capturePtyIncarnationIds(this.ptysById, [...this.ptysById.keys()])
    const result = await closeMainOwnedPaneByHandle(
      {
        runtime: this,
        livePty: () => this.getLivePtyForHandle(handle)?.pty ?? null,
        liveLeaf: () => this.getLiveLeafForHandle(handle).leaf,
        remoteSessionIdOf: (worktreeId, tabId) =>
          this.getWorkspaceSessionForWorktree(worktreeId)?.remoteSessionIdsByTabId?.[tabId],
        applyLayoutCommand: (command) => this.applyLayoutCommand(command),
        stop: (ptyIds, addressed) =>
          finishGuardedPtyStop(
            {
              ptysById: this.ptysById,
              stopExplicitlyClosedTabPtys: (ids, ptyId, incarnations) =>
                this.stopExplicitlyClosedTabPtys(ids, ptyId, incarnations)
            },
            handle,
            ptyIds,
            addressed,
            captured,
            options
          ),
        describe: (...args) => this.describeTerminalClose(...args)
      },
      handle,
      wholeTab
    )
    if (result) {
      this.claudeAgentTeams.removeTeamForLeaderHandle(handle)
    }
    return result
  }

  protected abstract getResolvedWorktreeMap(): Promise<Map<string, ResolvedWorktree>>
  protected abstract refreshPtyWorktreeRecordsFromController(
    resolvedWorktrees: ResolvedWorktree[],
    targetWorktreeId?: string | null,
    deadline?: number
  ): Promise<Set<string> | null>
  protected abstract getLivePtyIdsForWorktree(
    worktreeId: string,
    freshPtyIds?: ReadonlySet<string>,
    hostFence?: WorktreePtyHostFence
  ): Set<string>
  protected abstract getTerminalHandlesForPtyId(ptyId: string): string[]
  protected abstract getRecordedTerminalSleepHandles(
    ptyIds: Iterable<string>,
    terminalHandlesByPtyId: Readonly<Record<string, readonly string[]>>
  ): string[]
  protected abstract commitWorktreeTerminalSleepPtys(args: {
    worktreeId: string
    generation: number
    ptyIds: readonly string[]
    pendingPtyIds: Set<string>
    committedPtyIds: Set<string>
    terminalHandlesByPtyId: Readonly<Record<string, readonly string[]>>
  }): void

  protected async stopExplicitlyClosedTabPtys(
    ptyIds: readonly string[],
    addressedPtyId: string,
    capturedIncarnations?: ReadonlyMap<string, string>
  ): Promise<ExplicitCloseStop> {
    let addressedPtyStop = EXPLICIT_CLOSE_NO_STOP
    const deadlineMs = Date.now() + EXPLICIT_TERMINAL_CLOSE_STOP_TIMEOUT_MS
    for (const ptyId of ptyIds) {
      const capturedIncarnationId = capturedIncarnations?.get(ptyId)
      const liveIncarnationId = this.ptysById.get(ptyId)?.incarnationId
      if (capturedIncarnationId && liveIncarnationId !== capturedIncarnationId) {
        if (ptyId === addressedPtyId) {
          throw new Error('terminal_handle_stale')
        }
        continue
      }
      this.markPtyStopRequested(ptyId)
      const expectedIncarnationId = capturedIncarnationId ?? liveIncarnationId
      const stopOpts = expectedIncarnationId
        ? { deadlineMs, expectedIncarnationId }
        : { deadlineMs }
      let stopped = false
      if (this.ptyController?.stopAndWait) {
        try {
          stopped = await this.ptyController.stopAndWait(ptyId, stopOpts)
        } catch (error) {
          this.markPtyLivenessUnverifiable(ptyId, errorMessage(error))
        }
        const liveAfterWait = this.ptysById.get(ptyId)?.incarnationId
        if (expectedIncarnationId && liveAfterWait !== expectedIncarnationId) {
          if (ptyId === addressedPtyId) {
            throw new Error('terminal_handle_stale')
          }
          continue
        }
        // Preserve an observed exit when a broader inventory check could not finish.
        if (
          !stopped &&
          expectedIncarnationId &&
          liveAfterWait === expectedIncarnationId &&
          this.getPtyLivenessVerdict(ptyId)?.status === 'exited'
        ) {
          stopped = true
        }
        if (!stopped) {
          const verdict = this.getPtyLivenessVerdict(ptyId)
          const providerAlreadyRetiredPty =
            verdict?.status === 'unverifiable' &&
            verdict.reason === SSH_PROVIDER_UNREGISTERED_REASON
          if (!providerAlreadyRetiredPty) {
            this.ptyController.kill(ptyId, {
              expectedIncarnationId: expectedIncarnationId ?? undefined
            })
            if (!verdict || verdict.status === 'live') {
              this.markPtyLivenessUnverifiable(
                ptyId,
                'a follow-up stop was issued but its outcome could not be verified'
              )
            }
          }
        }
      } else {
        stopped =
          this.ptyController?.kill(ptyId, {
            expectedIncarnationId: expectedIncarnationId ?? undefined
          }) ?? false
      }
      if (ptyId === addressedPtyId) {
        addressedPtyStop = { stopped }
      }
    }
    return addressedPtyStop
  }
}
