import type { RuntimeTerminalClose } from '../../../shared/runtime-types'
import { parsePaneKey } from '../../../shared/stable-pane-id'
import type { RuntimePtyTabCloseAuthority } from '../runtime-terminal-state-records'
import {
  capturePtyIncarnationIds,
  finishGuardedPtyStop,
  type GcCloseStopHost,
  type TerminalGcCloseStopOptions
} from '../rpc/methods/terminal/terminal-gc-close-stop-fence'
import {
  OrcaRuntimeWithStopExplicitlyClosedTabPtys,
  EXPLICIT_CLOSE_NO_STOP,
  type ExplicitCloseStop
} from './explicit-terminal-close-stops'

export abstract class OrcaRuntimeWithCloseTerminal extends OrcaRuntimeWithStopExplicitlyClosedTabPtys {
  protected describeTerminalClose(
    handle: string,
    tabId: string,
    ptyId: string | null,
    stop: ExplicitCloseStop
  ): RuntimeTerminalClose {
    const close: RuntimeTerminalClose = { handle, tabId, ptyKilled: stop.stopped }
    if (stop.stopped || !ptyId) {
      return close
    }
    const verdict = this.getPtyLivenessVerdict(ptyId)
    if (verdict?.status === 'unverifiable') {
      return { ...close, ptyStopVerdict: 'unverifiable', ptyStopReason: verdict.reason }
    }
    if (verdict?.status === 'live') {
      return { ...close, ptyStopVerdict: 'live' }
    }
    return close
  }

  async closeTerminal(
    handle: string,
    options?: TerminalGcCloseStopOptions
  ): Promise<RuntimeTerminalClose> {
    const pty = this.getLivePtyForHandle(handle)
    if (options?.expectedIncarnationId) {
      const liveIncarnation = pty?.pty.incarnationId
      if (!liveIncarnation || liveIncarnation !== options.expectedIncarnationId) {
        if (!pty) {
          const { leaf } = this.getLiveLeafForHandle(handle)
          const leafIncarnation = leaf.ptyId ? this.ptysById.get(leaf.ptyId)?.incarnationId : null
          if (!leafIncarnation || leafIncarnation !== options.expectedIncarnationId) {
            throw new Error('terminal_handle_stale')
          }
        } else {
          throw new Error('terminal_handle_stale')
        }
      }
    }
    const mainClose = await this.closeMainOwnedTerminal(handle, false, options)
    if (mainClose) {
      return mainClose
    }
    this.claudeAgentTeams.removeTeamForLeaderHandle(handle)
    const gcCloseHost: GcCloseStopHost = {
      ptysById: this.ptysById,
      stopExplicitlyClosedTabPtys: (ptyIds, addressedPtyId, capturedIncarnations) =>
        this.stopExplicitlyClosedTabPtys(ptyIds, addressedPtyId, capturedIncarnations)
    }
    const finishStop = (
      ids: readonly string[],
      addressed: string,
      captured: ReadonlyMap<string, string>
    ) => finishGuardedPtyStop(gcCloseHost, handle, ids, addressed, captured, options)
    if (pty) {
      const closeAuthority: RuntimePtyTabCloseAuthority = {
        handle,
        ptyId: pty.pty.ptyId,
        incarnationId: pty.pty.incarnationId,
        worktreeId: pty.pty.worktreeId
      }
      const ptyCloseAuthority = this.resolvePtyTabCloseSurfaceAuthority(closeAuthority)
      const spawnSurface = pty.pty.tabId
        ? this.findMobileTerminalSurface(pty.pty.worktreeId, pty.pty.tabId)
        : null
      // Why: PTY exit can immediately replace a ready SSH publication with a pending one, so capture its durable HUB surface before killing it.
      const surface =
        ptyCloseAuthority?.surface ??
        (spawnSurface && this.getMobileTerminalLeafPtyIds(spawnSurface.tab).length === 0
          ? spawnSurface
          : null)
      const tabId = surface?.tab.parentTabId ?? pty.pty.tabId ?? pty.record.tabId
      const leafId = surface?.tab.leafId ?? parsePaneKey(pty.pty.paneKey ?? '')?.leafId
      const paneTarget = leafId ? { kind: 'pane' as const, tabId, leafId } : null
      // Why: a PTY with no pane identity cannot be placed in any tab's layout, so it closes nothing.
      const closesTab =
        paneTarget !== null &&
        this.resolveTerminalCloseTarget(pty.pty.worktreeId, paneTarget) === 'last-pane'
      if (closesTab && surface && this.tabs.has(tabId) && this.notifier?.closeTerminalTab) {
        const ptyIdsToKill = this.getPtyIdsForExplicitTabClose(pty.pty.worktreeId, tabId)
        const captured = capturePtyIncarnationIds(this.ptysById, ptyIdsToKill)
        try {
          await this.closeMobileSessionTab(`id:${pty.pty.worktreeId}`, tabId, {
            localPtyTeardownOwnedExternally: true
          })
        } catch (error) {
          if (!(error instanceof Error) || error.message !== 'workspace_session_unavailable') {
            throw error
          }
          this.notifyRendererOfHeadlessTerminalClose(tabId)
        }
        const stop = await finishStop(ptyIdsToKill, pty.pty.ptyId, captured)
        return this.describeTerminalClose(handle, tabId, pty.pty.ptyId, stop)
      }
      if (closesTab && surface && ptyCloseAuthority && !this.tabs.has(surface.tab.parentTabId)) {
        const captured = capturePtyIncarnationIds(this.ptysById, [pty.pty.ptyId])
        try {
          await this.closeMobileSessionTab(`id:${pty.pty.worktreeId}`, tabId, {
            reason: 'user',
            localPtyTeardownOwnedExternally: true,
            expectedPtyCloseAuthority: closeAuthority
          })
        } catch (error) {
          if (!(error instanceof Error) || error.message !== 'workspace_session_unavailable') {
            throw error
          }
          const stop = await finishStop([pty.pty.ptyId], pty.pty.ptyId, captured)
          this.notifyRendererOfHeadlessTerminalClose(tabId)
          return this.describeTerminalClose(handle, tabId, pty.pty.ptyId, stop)
        }
        const stop = await finishStop([pty.pty.ptyId], pty.pty.ptyId, captured)
        return this.describeTerminalClose(handle, tabId, pty.pty.ptyId, stop)
      }
      // Why the tabs guard: a headless host has no renderer tab to close through the notifier.
      if (
        closesTab &&
        !surface &&
        pty.pty.tabId &&
        this.tabs.has(tabId) &&
        this.notifier?.closeTerminalTab
      ) {
        const ptyIdsToKill = this.getPtyIdsForExplicitTabClose(pty.pty.worktreeId, tabId)
        const captured = capturePtyIncarnationIds(this.ptysById, ptyIdsToKill)
        try {
          await this.notifier.closeTerminalTab(tabId, { localPtyTeardownOwnedExternally: true })
        } catch (error) {
          // The tab went away concurrently; still stop only the captured incarnation.
          if (!(error instanceof Error) || error.message !== 'tab_not_found') {
            throw error
          }
        }
        const stop = await finishStop(ptyIdsToKill, pty.pty.ptyId, captured)
        return this.describeTerminalClose(handle, tabId, pty.pty.ptyId, stop)
      }
      const stop = await finishStop(
        [pty.pty.ptyId],
        pty.pty.ptyId,
        capturePtyIncarnationIds(this.ptysById, [pty.pty.ptyId])
      )
      if (!closesTab) {
        // Why: the pane's removal is this close's own commit, not a side effect of its exit. An
        // unconfirmed stop is unverifiable, never a reason to close the live siblings with it.
        if (paneTarget) {
          await this.closeTerminalPane(pty.pty.worktreeId, paneTarget)
        }
      } else if (surface) {
        // Why: paired viewers keep ended streams mounted until the HUB publishes removal, so explicit close uses the durable host-tab transaction instead of viewer-local exit handling.
        try {
          await this.closeMobileSessionTab(`id:${pty.pty.worktreeId}`, tabId, {
            localPtyTeardownOwnedExternally: true
          })
        } catch (error) {
          if (!(error instanceof Error) || error.message !== 'workspace_session_unavailable') {
            throw error
          }
          this.notifyRendererOfHeadlessTerminalClose(tabId)
        }
      } else {
        this.notifyRendererOfHeadlessTerminalClose(tabId)
      }
      return this.describeTerminalClose(handle, tabId, pty.pty.ptyId, stop)
    }
    this.assertGraphReady()
    const { leaf } = this.getLiveLeafForHandle(handle)
    const paneTarget = { kind: 'pane' as const, tabId: leaf.tabId, leafId: leaf.leafId }
    const hostClose = await this.closeOnOwningPairedHost(
      handle,
      leaf,
      'terminal.close',
      this.resolveTerminalCloseTarget(leaf.worktreeId, paneTarget) === 'last-pane'
    )
    if (hostClose && !hostClose.stillBound) {
      return { handle, tabId: leaf.tabId, ...hostClose.close }
    }
    const closesTab = this.resolveTerminalCloseTarget(leaf.worktreeId, paneTarget) === 'last-pane'
    const ptyIdsToKill = closesTab
      ? this.getPtyIdsForExplicitTabClose(leaf.worktreeId, leaf.tabId)
      : leaf.ptyId
        ? [leaf.ptyId]
        : []
    const captured = capturePtyIncarnationIds(this.ptysById, ptyIdsToKill)
    if (closesTab && this.notifier?.closeTerminalTab) {
      await this.notifier.closeTerminalTab(leaf.tabId, { localPtyTeardownOwnedExternally: true })
    }
    if (hostClose) {
      if (!closesTab) {
        await this.closeTerminalPane(leaf.worktreeId, paneTarget)
      } else if (!this.notifier?.closeTerminalTab) {
        this.notifier?.closeTerminal(leaf.tabId)
      }
      return { handle, tabId: leaf.tabId, ...hostClose.close }
    }
    const stop = leaf.ptyId
      ? await finishStop(ptyIdsToKill, leaf.ptyId, captured)
      : EXPLICIT_CLOSE_NO_STOP
    if (!closesTab) {
      await this.closeTerminalPane(leaf.worktreeId, paneTarget)
    } else if (!this.notifier?.closeTerminalTab) {
      this.notifier?.closeTerminal(leaf.tabId)
    }
    return this.describeTerminalClose(handle, leaf.tabId, leaf.ptyId ?? null, stop)
  }

  async closeTerminalTab(handle: string): Promise<RuntimeTerminalClose> {
    const mainClose = await this.closeMainOwnedTerminal(handle, true)
    if (mainClose) {
      return mainClose
    }
    const pty = this.getLivePtyForHandle(handle)
    if (pty) {
      const closeAuthority: RuntimePtyTabCloseAuthority = {
        handle,
        ptyId: pty.pty.ptyId,
        incarnationId: pty.pty.incarnationId,
        worktreeId: pty.pty.worktreeId
      }
      const tabId =
        this.resolvePtyTabCloseSurfaceAuthority(closeAuthority)?.surface.tab.parentTabId ??
        pty.pty.tabId
      if (!tabId) {
        return this.closeTerminal(handle)
      }
      // Why: a handle-addressed CLI/automation close is an explicit intent, so
      // it must stay destructive under the non-user close adjudication gate.
      await this.closeMobileSessionTab(`id:${pty.pty.worktreeId}`, tabId, {
        reason: 'user',
        expectedPtyCloseAuthority: closeAuthority
      })
      this.claudeAgentTeams.removeTeamForLeaderHandle(handle)
      return { handle, tabId, closeMode: 'tab', ptyKilled: false }
    }
    this.assertGraphReady()
    const { leaf } = this.getLiveLeafForHandle(handle)
    const hostClose = await this.closeOnOwningPairedHost(handle, leaf, 'terminal.closeTab', true)
    if (hostClose && !hostClose.stillBound) {
      return { handle, tabId: leaf.tabId, ...hostClose.close, closeMode: 'tab' }
    }
    await this.closeMobileSessionTab(`id:${leaf.worktreeId}`, leaf.tabId, { reason: 'user' })
    this.claudeAgentTeams.removeTeamForLeaderHandle(handle)
    return { handle, tabId: leaf.tabId, ptyKilled: false, ...hostClose?.close, closeMode: 'tab' }
  }
}
