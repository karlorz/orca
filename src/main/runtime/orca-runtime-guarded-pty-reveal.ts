// @ts-nocheck -- mechanically split from OrcaRuntimeService; behavior is covered by AST equivalence and characterization tests.
import { OrcaRuntimeWithWaitForLeafPtyId } from './orca-runtime-wait-for-leaf-pty-id'
import type { RuntimeTerminalFocus } from '../../shared/runtime-types'
import { parsePaneKey } from '../../shared/stable-pane-id'
import { getLatestPtyTitle } from './runtime-worktree-status-projection'
import { copySleepingAgentLaunchConfig } from './runtime-agent-launch-resolution'
import type { TerminalHandleRecord } from './runtime-terminal-contracts'
import type { RuntimePtyWorktreeRecord } from './runtime-terminal-state-records'

export type LivePtyHandle = { record: TerminalHandleRecord; pty: RuntimePtyWorktreeRecord }

type RetainedHandleInspection =
  | { kind: 'unrelated' }
  | { kind: 'inconsistent' }
  | { kind: 'live'; live: LivePtyHandle }

type LivePtyIdentity = {
  handle: string
  runtimeId: string
  ptyId: string
  incarnationId: string | null
  tabId: string
  leafId: string
  worktreeId: string
}

export type FocusTerminalOptions = {
  navigateHost?: boolean
  expectedIncarnationId?: string
  existingSessionOnly?: boolean
  verifySession?: () => boolean
  activateHostWindow?: boolean
}

export class OrcaRuntimeWithGuardedPtyReveal extends OrcaRuntimeWithWaitForLeafPtyId {
  private inspectRetainedHandle(handle: string): RetainedHandleInspection {
    const record = this.handles.get(handle)
    if (
      !record ||
      record.runtimeId !== this.runtimeId ||
      !record.ptyId ||
      record.tabId.startsWith('pty:')
    ) {
      return { kind: 'unrelated' }
    }
    const leaf = this.leaves.get(this.getLeafKey(record.tabId, record.leafId))
    if (!leaf || leaf.ptyId !== record.ptyId) {
      return { kind: 'unrelated' }
    }
    const pty = this.ptysById.get(record.ptyId)
    if (!pty || pty.ptyId !== record.ptyId || !pty.connected) {
      return { kind: 'unrelated' }
    }
    const parsedPaneKey = parsePaneKey(pty.paneKey ?? '')
    if (!parsedPaneKey) {
      return { kind: 'unrelated' }
    }
    const consistent =
      record.rendererGraphEpoch === this.rendererGraphEpoch &&
      leaf.ptyGeneration === record.ptyGeneration &&
      leaf.tabId === record.tabId &&
      leaf.leafId === record.leafId &&
      record.worktreeId === leaf.worktreeId &&
      leaf.worktreeId === pty.worktreeId &&
      record.tabId === pty.tabId &&
      record.tabId === parsedPaneKey.tabId &&
      record.leafId === parsedPaneKey.leafId
    return consistent ? { kind: 'live', live: { record, pty } } : { kind: 'inconsistent' }
  }

  protected getLivePtyForRetainedHandle(handle: string): LivePtyHandle | null {
    const inspection = this.inspectRetainedHandle(handle)
    return inspection.kind === 'live' ? inspection.live : null
  }

  protected retainedHandleIdentityIsInconsistent(handle: string): boolean {
    return this.inspectRetainedHandle(handle).kind === 'inconsistent'
  }

  private livePtyIdentity(handle: string, live: LivePtyHandle): LivePtyIdentity {
    return {
      handle,
      runtimeId: live.record.runtimeId,
      ptyId: live.pty.ptyId,
      incarnationId: live.pty.incarnationId,
      tabId: live.pty.tabId ?? live.record.tabId,
      leafId: live.record.leafId,
      worktreeId: live.pty.worktreeId
    }
  }

  private matchesCapturedIdentity(
    live: LivePtyHandle | null,
    captured: LivePtyIdentity,
    handle: string
  ): boolean {
    if (!live) {
      return false
    }
    const current = this.livePtyIdentity(handle, live)
    return (
      current.handle === captured.handle &&
      current.runtimeId === captured.runtimeId &&
      current.ptyId === captured.ptyId &&
      current.incarnationId === captured.incarnationId &&
      current.tabId === captured.tabId &&
      current.leafId === captured.leafId &&
      current.worktreeId === captured.worktreeId
    )
  }

  protected async focusLivePtyTerminal(
    handle: string,
    resolveLive: () => LivePtyHandle | null,
    options: FocusTerminalOptions
  ): Promise<RuntimeTerminalFocus> {
    const navigateHost = options.navigateHost !== false
    const livePtyIdentity = (): RuntimeTerminalFocus => {
      const live = resolveLive()
      if (!live?.pty.connected) {
        throw new Error('terminal_exited')
      }
      return {
        handle,
        tabId: live.pty.tabId ?? live.record.tabId,
        worktreeId: live.pty.worktreeId,
        navigated: false
      }
    }

    const resolved = resolveLive()
    if (!resolved?.pty.connected) {
      throw new Error('terminal_exited')
    }
    if (
      options.expectedIncarnationId &&
      resolved.pty.incarnationId !== options.expectedIncarnationId
    ) {
      throw new Error('terminal_handle_stale')
    }
    const capturedIdentity = this.livePtyIdentity(handle, resolved)
    if (!navigateHost || !this.notifier?.revealTerminalSession) {
      return {
        handle,
        tabId: resolved.pty.tabId ?? resolved.record.tabId,
        worktreeId: resolved.pty.worktreeId,
        navigated: false
      }
    }
    // Coalesce concurrent host navigations: only the latest full reveal claims navigated.
    return this.terminalFocusNavigationCoalescer.run({
      key: handle,
      resolveSuperseded: (completed) =>
        completed ? { ...completed, navigated: false } : livePtyIdentity(),
      run: async (ctx) => {
        const live = resolveLive()
        if (!live?.pty.connected) {
          throw new Error('terminal_exited')
        }
        if (
          options.expectedIncarnationId &&
          live.pty.incarnationId !== options.expectedIncarnationId
        ) {
          throw new Error('terminal_handle_stale')
        }
        if (!ctx.isCurrent()) {
          return {
            handle,
            tabId: live.pty.tabId ?? live.record.tabId,
            worktreeId: live.pty.worktreeId,
            navigated: false
          }
        }
        const notifier = this.notifier
        if (!notifier?.revealTerminalSession) {
          return {
            handle,
            tabId: live.pty.tabId ?? live.record.tabId,
            worktreeId: live.pty.worktreeId,
            navigated: false
          }
        }
        const parsedPaneKey = parsePaneKey(live.pty.paneKey ?? '')
        const revealed = await notifier.revealTerminalSession(live.pty.worktreeId, {
          ptyId: live.pty.ptyId,
          title: getLatestPtyTitle(this.getPtyDisplayRecord(live.pty)),
          ...(live.pty.launchConfig && !options.existingSessionOnly
            ? { launchConfig: copySleepingAgentLaunchConfig(live.pty.launchConfig) }
            : {}),
          ...(live.pty.launchToken ? { launchToken: live.pty.launchToken } : {}),
          ...(live.pty.launchAgent ? { launchAgent: live.pty.launchAgent } : {}),
          ...(live.pty.tabId !== null ? { tabId: live.pty.tabId } : {}),
          ...(parsedPaneKey ? { leafId: parsedPaneKey.leafId } : {}),
          ...(options.activateHostWindow === true ? { activateHostWindow: true } : {}),
          ...(options.existingSessionOnly
            ? {
                existingSessionOnly: true,
                focus: true,
                expectedProcessIdentity: {
                  terminalHandle: handle,
                  incarnationId: options.expectedIncarnationId
                },
                canFocusExistingSession: () =>
                  ctx.isCurrent() &&
                  options.verifySession?.() === true &&
                  this.matchesCapturedIdentity(resolveLive(), capturedIdentity, handle)
              }
            : {})
        })
        if (
          options.expectedIncarnationId &&
          resolveLive()?.pty.incarnationId !== options.expectedIncarnationId
        ) {
          throw new Error('terminal_handle_stale')
        }
        if (!ctx.isCurrent() || this.notifier !== notifier) {
          return {
            handle,
            tabId: revealed?.tabId ?? live.pty.tabId ?? live.record.tabId,
            worktreeId: live.pty.worktreeId,
            navigated: false
          }
        }
        if (!this.matchesCapturedIdentity(resolveLive(), capturedIdentity, handle)) {
          throw new Error('terminal_handle_stale')
        }
        return {
          handle,
          tabId: revealed?.tabId ?? live.pty.tabId ?? live.record.tabId,
          worktreeId: live.pty.worktreeId,
          navigated: true,
          ...(revealed?.identity ? { identity: revealed.identity } : {}),
          ...(revealed?.windowFocused !== undefined
            ? { windowFocused: revealed.windowFocused }
            : {}),
          ...(revealed?.paneFocused !== undefined ? { paneFocused: revealed.paneFocused } : {})
        }
      }
    })
  }
}
