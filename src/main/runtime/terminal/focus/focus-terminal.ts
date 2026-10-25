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
import { getLatestPtyTitle } from '../../runtime-worktree-status-projection'
import { copySleepingAgentLaunchConfig } from '../../runtime-agent-launch-resolution'
import type { OrcaRuntimeWithBuildPtyTerminalSummary as PtyTerminalSummaryMethods } from '../query/pty-terminal-summary'
import type {
  GrokSessionBinding,
  GrokSessionTerminalOwner
} from '../../../../shared/grok-session-binding'
import {
  switchOriginatingPaneWithHost,
  type OriginatingPaneNavigationReceipt,
  type OriginatingPaneTarget,
  type TerminalOriginatingPaneHost
} from '../../terminal-originating-pane-navigation'

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

  async switchOriginatingPane(
    target: OriginatingPaneTarget,
    options: { activateHostWindow?: boolean } = {}
  ): Promise<OriginatingPaneNavigationReceipt> {
    const host: TerminalOriginatingPaneHost = {
      getAgentStatusSnapshot: () => this.getAgentStatusSnapshotFn?.() ?? [],
      readObservedAgentStatusPaneIdentity: (paneKey: string) =>
        this.readObservedAgentStatusPaneIdentityFn(paneKey),
      getLivePtyForHandle: (handle: string) => {
        const live = this.getLivePtyForHandle(handle) ?? this.getLivePtyForRetainedHandle(handle)
        if (!live) {
          return null
        }
        return {
          record: {
            handle: live.record.handle,
            ptyId: live.record.ptyId ?? undefined
          },
          pty: {
            ptyId: live.pty.ptyId,
            incarnationId: live.pty.incarnationId,
            paneKey: live.pty.paneKey,
            worktreeId: live.pty.worktreeId,
            tabId: live.pty.tabId,
            connected: live.pty.connected,
            connectionId: live.pty.connectionId,
            ...(live.pty.isWsl == null ? {} : { isWsl: live.pty.isWsl })
          }
        }
      },
      getRendererLeaf: (tabId: string, leafId: string) => {
        this.assertGraphReady()
        return this.leaves.get(this.getLeafKey(tabId, leafId)) ?? null
      },
      resolveWorktree: async (worktreeId: string) => {
        try {
          const resolved = await this.resolveWorktreeSelector(`id:${worktreeId}`)
          const rootPath = 'rootPath' in resolved ? resolved.rootPath : undefined
          return {
            id: resolved.id,
            path: resolved.git.path,
            ...(typeof rootPath === 'string' ? { rootPath } : {})
          }
        } catch {
          return null
        }
      },
      focusTerminal: async (handle, options) => {
        const focused = await this.focusTerminal(handle, options)
        return {
          navigated: focused.navigated === true,
          tabId: focused.tabId,
          worktreeId: focused.worktreeId,
          identity: focused.identity,
          windowFocused: focused.windowFocused,
          paneFocused: focused.paneFocused
        }
      }
    }
    return switchOriginatingPaneWithHost(host, target, options)
  }

  async focusTerminal(
    handle: string,
    options: FocusTerminalOptions = {}
  ): Promise<RuntimeTerminalFocus> {
    const navigateHost = options.navigateHost !== false
    const livePtyIdentity = (): RuntimeTerminalFocus => {
      const live = this.getLivePtyForHandle(handle)
      if (!live?.pty.connected) {
        throw new Error('terminal_exited')
      }
      return {
        handle,
        tabId: this.paneOfPty(live.pty).tabId ?? live.record.tabId,
        worktreeId: live.pty.worktreeId,
        navigated: false
      }
    }
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

    const pty = this.getLivePtyForHandle(handle)
    if (pty) {
      if (!pty.pty.connected) {
        throw new Error('terminal_exited')
      }
      if (!navigateHost || !this.notifier?.revealTerminalSession) {
        return {
          handle,
          tabId: this.paneOfPty(pty.pty).tabId ?? pty.record.tabId,
          worktreeId: pty.pty.worktreeId,
          navigated: false
        }
      }
      // Coalesce concurrent host navigations: only the latest full reveal claims navigated.
      return this.terminalFocusNavigationCoalescer.run({
        key: handle,
        resolveSuperseded: (completed) =>
          completed ? { ...completed, navigated: false } : livePtyIdentity(),
        run: async (ctx) => {
          const live = this.getLivePtyForHandle(handle)
          if (!live?.pty.connected) {
            throw new Error('terminal_exited')
          }
          if (!ctx.isCurrent()) {
            return {
              handle,
              tabId: this.paneOfPty(live.pty).tabId ?? live.record.tabId,
              worktreeId: live.pty.worktreeId,
              navigated: false
            }
          }
          const notifier = this.notifier
          if (!notifier?.revealTerminalSession) {
            return {
              handle,
              tabId: this.paneOfPty(live.pty).tabId ?? live.record.tabId,
              worktreeId: live.pty.worktreeId,
              navigated: false
            }
          }
          const recorded = this.paneOfPty(live.pty)
          const parsedPaneKey = parsePaneKey(recorded.paneKey ?? '')
          const revealed = await notifier.revealTerminalSession(live.pty.worktreeId, {
            ptyId: live.pty.ptyId,
            title:
              this.getPtyManualTitle(live.pty, false) ??
              getLatestPtyTitle(this.getPtyDisplayRecord(live.pty)),
            ...(live.pty.launchConfig
              ? { launchConfig: copySleepingAgentLaunchConfig(live.pty.launchConfig) }
              : {}),
            ...(live.pty.launchToken ? { launchToken: live.pty.launchToken } : {}),
            ...(live.pty.launchAgent ? { launchAgent: live.pty.launchAgent } : {}),
            ...(recorded.tabId !== null ? { tabId: recorded.tabId } : {}),
            ...(parsedPaneKey ? { leafId: parsedPaneKey.leafId } : {})
          })
          if (!ctx.isCurrent() || this.notifier !== notifier) {
            return {
              handle,
              tabId: revealed?.tabId ?? this.paneOfPty(live.pty).tabId ?? live.record.tabId,
              worktreeId: live.pty.worktreeId,
              navigated: false
            }
          }
          return {
            handle,
            tabId: revealed?.tabId ?? this.paneOfPty(live.pty).tabId ?? live.record.tabId,
            worktreeId: live.pty.worktreeId,
            navigated: true
          }
        }
      })
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
