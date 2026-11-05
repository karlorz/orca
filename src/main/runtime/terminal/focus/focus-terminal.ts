import {
  OrcaRuntimeWithGuardedPtyReveal,
  type FocusTerminalOptions
} from '../../orca-runtime-guarded-pty-reveal'
import type { RuntimeTerminalFocus } from '../../../../shared/runtime-types'
import type {
  RuntimeTerminalReveal,
  TerminalPaneRevealTarget
} from '../../../../shared/terminal-pane-reveal'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import type { OrcaRuntimeWithBuildPtyTerminalSummary as PtyTerminalSummaryMethods } from '../query/pty-terminal-summary'
import type {
  GrokSessionBinding,
  GrokSessionTerminalOwner
} from '../../../../shared/grok-session-binding'

export abstract class OrcaRuntimeWithFocusTerminal extends OrcaRuntimeWithGuardedPtyReveal {
  protected abstract getPtyManualTitle(
    ...args: Parameters<PtyTerminalSummaryMethods['getPtyManualTitle']>
  ): ReturnType<PtyTerminalSummaryMethods['getPtyManualTitle']>

  getSessionTerminalOwner(paneKey: string): GrokSessionTerminalOwner | null {
    const matches = [...this.ptysById.values()].filter(
      (pty) => pty.paneKey === paneKey && pty.connected
    )
    const parsed = parsePaneKey(paneKey)
    if (matches.length !== 1 || !parsed) {
      return null
    }
    const pty = matches[0]
    if (
      pty.connectionId !== null ||
      pty.isWsl === true ||
      !pty.incarnationId ||
      !pty.launchToken ||
      pty.launchIncarnationId !== pty.incarnationId ||
      pty.tabId !== parsed.tabId
    ) {
      return null
    }
    return {
      runtimeId: this.runtimeId,
      executionHostId: 'local',
      handle: this.issuePtyHandle(pty),
      ptyId: pty.ptyId,
      incarnationId: pty.incarnationId,
      paneKey,
      tabId: parsed.tabId,
      leafId: parsed.leafId,
      worktreeId: pty.worktreeId,
      launchToken: pty.launchToken
    }
  }

  async revealSessionTerminal(
    binding: GrokSessionBinding,
    verifySession: () => boolean,
    options: { activateHostWindow?: boolean } = {}
  ) {
    const live = this.getSessionTerminalOwner(binding.paneKey)
    if (
      !live ||
      live.handle !== binding.handle ||
      live.incarnationId !== binding.incarnationId ||
      live.runtimeId !== binding.runtimeId ||
      live.ptyId !== binding.ptyId ||
      live.tabId !== binding.tabId ||
      live.leafId !== binding.leafId ||
      live.worktreeId !== binding.worktreeId ||
      !this.notifier?.revealTerminalSession
    ) {
      throw new Error('session_binding_unverifiable')
    }
    const receipt = await this.focusTerminal(binding.handle, {
      expectedIncarnationId: binding.incarnationId,
      existingSessionOnly: true,
      verifySession,
      activateHostWindow: options.activateHostWindow === true,
      flashFocusedPane: true
    })
    const current = this.getSessionTerminalOwner(binding.paneKey)
    if (
      !current ||
      current.runtimeId !== binding.runtimeId ||
      current.handle !== binding.handle ||
      current.ptyId !== binding.ptyId ||
      current.incarnationId !== binding.incarnationId ||
      current.tabId !== binding.tabId ||
      current.leafId !== binding.leafId ||
      current.worktreeId !== binding.worktreeId ||
      receipt.navigated !== true ||
      !receipt.identity
    ) {
      throw new Error('session_navigation_unverifiable')
    }
    return receipt
  }

  async focusTerminal(
    handle: string,
    options: FocusTerminalOptions = {}
  ): Promise<RuntimeTerminalFocus> {
    const navigateHost = options.navigateHost !== false
    const liveLeafIdentity = (): RuntimeTerminalFocus => {
      this.assertGraphReady()
      const { leaf: current } = this.getLiveLeafForHandle(handle)
      return {
        handle,
        tabId: current.tabId,
        worktreeId: current.worktreeId,
        navigated: false
      }
    }

    if (this.retainedHandleIdentityIsInconsistent(handle)) {
      throw new Error('terminal_handle_stale')
    }

    const resolveRetained = () => this.getLivePtyForRetainedHandle(handle)
    if (resolveRetained()) {
      return this.focusLivePtyTerminal(handle, resolveRetained, options)
    }

    const record = this.handles.get(handle)
    if (options.existingSessionOnly && record && !record.tabId.startsWith('pty:')) {
      throw new Error('terminal_handle_stale')
    }

    const resolveOwned = () => this.getLivePtyForHandle(handle)
    const owned = resolveOwned()
    if (owned) {
      if (!owned.pty.connected) {
        throw new Error('terminal_exited')
      }
      return this.focusLivePtyTerminal(handle, resolveOwned, options)
    }

    this.assertGraphReady()
    const { leaf } = this.getLiveLeafForHandle(handle)
    if (!navigateHost) {
      return {
        handle,
        tabId: leaf.tabId,
        worktreeId: leaf.worktreeId,
        navigated: false
      }
    }
    if (!this.notifier?.focusTerminal) {
      return {
        handle,
        tabId: leaf.tabId,
        worktreeId: leaf.worktreeId,
        navigated: false
      }
    }
    return this.terminalFocusNavigationCoalescer.run({
      key: handle,
      resolveSuperseded: (completed) =>
        completed ? { ...completed, navigated: false } : liveLeafIdentity(),
      run: async (ctx) => {
        this.assertGraphReady()
        const { leaf: liveLeaf } = this.getLiveLeafForHandle(handle)
        if (!ctx.isCurrent()) {
          return {
            handle,
            tabId: liveLeaf.tabId,
            worktreeId: liveLeaf.worktreeId,
            navigated: false
          }
        }
        const notifier = this.notifier
        if (!notifier?.focusTerminal) {
          return {
            handle,
            tabId: liveLeaf.tabId,
            worktreeId: liveLeaf.worktreeId,
            navigated: false
          }
        }
        notifier.focusTerminal(liveLeaf.tabId, liveLeaf.worktreeId, liveLeaf.leafId)
        if (!ctx.isCurrent() || this.notifier !== notifier) {
          return {
            handle,
            tabId: liveLeaf.tabId,
            worktreeId: liveLeaf.worktreeId,
            navigated: false
          }
        }
        return {
          handle,
          tabId: liveLeaf.tabId,
          worktreeId: liveLeaf.worktreeId,
          navigated: true
        }
      }
    })
  }

  async revealTerminalPane(target: TerminalPaneRevealTarget): Promise<RuntimeTerminalReveal> {
    const notifier = this.notifier
    if (!notifier?.revealTerminalPane) {
      throw new Error('renderer_unavailable')
    }
    return { ...target, navigated: await notifier.revealTerminalPane(target) }
  }

  protected getPtyIdsForExplicitTabClose(worktreeId: string, tabId: string): string[] {
    const ptyIds = new Set<string>()
    for (const pty of this.ptysById.values()) {
      if (pty.connected && pty.worktreeId === worktreeId && this.paneOfPty(pty).tabId === tabId) {
        ptyIds.add(pty.ptyId)
      }
    }
    for (const leaf of this.leaves.values()) {
      if (leaf.worktreeId === worktreeId && leaf.tabId === tabId && leaf.ptyId) {
        ptyIds.add(leaf.ptyId)
      }
    }
    return [...ptyIds]
  }
}
