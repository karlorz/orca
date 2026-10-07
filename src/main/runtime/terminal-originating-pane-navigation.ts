import { AGENT_STATUS_STALE_AFTER_MS } from '../../shared/agent-status-types'
import type { AgentStatusIpcPayload } from '../../shared/agent-status-ipc-payload'
import { parsePaneKey } from '../../shared/stable-pane-id'
import type { TerminalRevealIdentity } from '../../shared/terminal-reveal-identity'

import type {
  OriginatingPaneTarget,
  OriginatingPaneNavigationReceipt,
  OriginatingPaneCandidate,
  TerminalOriginatingPaneHost
} from './terminal-originating-pane-navigation-types'
export type {
  OriginatingPaneTarget,
  OriginatingPaneNavigationReceipt,
  TerminalOriginatingPaneHost
} from './terminal-originating-pane-navigation-types'

function checkRowFreshness(row: AgentStatusIpcPayload, now: number): void {
  const observedAt = Number.isFinite(row.evidenceObservedAt)
    ? row.evidenceObservedAt!
    : row.receivedAt
  if (
    !Number.isFinite(observedAt) ||
    now - observedAt > AGENT_STATUS_STALE_AFTER_MS ||
    observedAt > now + 60_000
  ) {
    throw new Error('session_binding_unverifiable')
  }
  if (
    !Number.isFinite(row.receivedAt) ||
    now - row.receivedAt > AGENT_STATUS_STALE_AFTER_MS ||
    row.receivedAt > now + 60_000
  ) {
    throw new Error('session_binding_unverifiable')
  }
}

export async function selectOriginatingPaneCandidate(
  host: TerminalOriginatingPaneHost,
  target: OriginatingPaneTarget
): Promise<OriginatingPaneCandidate> {
  const matches = host
    .getAgentStatusSnapshot()
    .filter(
      (row) => row.agentType === target.provider && row.providerSession?.id === target.session
    )
  if (matches.length > 1) {
    throw new Error('session_binding_ambiguous')
  }
  if (matches.length === 0) {
    throw new Error('session_binding_unverifiable')
  }

  const row = matches[0]
  if (row.connectionId !== null) {
    throw new Error('session_navigation_host_required')
  }
  if (row.providerSessionOnly === true || row.restoredUnconfirmed === true) {
    throw new Error('session_binding_unverifiable')
  }
  if (
    !row.observation ||
    row.observation.origin !== 'hook' ||
    row.observation.kind !== 'transition'
  ) {
    throw new Error('session_binding_unverifiable')
  }
  checkRowFreshness(row, host.now ? host.now() : Date.now())

  const observed = host.readObservedAgentStatusPaneIdentity(row.paneKey)
  if (!observed || observed.kind !== 'observed') {
    throw new Error('session_binding_unverifiable')
  }
  if (row.terminalHandle && row.terminalHandle !== observed.terminalHandle) {
    throw new Error('session_binding_unverifiable')
  }

  const live = host.getLivePtyForHandle(observed.terminalHandle)
  if (!live) {
    throw new Error('session_binding_unverifiable')
  }
  const { pty, record } = live
  if (pty.connectionId !== null || pty.isWsl === true) {
    throw new Error('session_navigation_host_required')
  }
  if (!pty.connected || !pty.incarnationId || pty.paneKey !== row.paneKey) {
    throw new Error('session_binding_unverifiable')
  }
  if (observed.processIncarnation !== `${pty.ptyId}:${pty.incarnationId}`) {
    throw new Error('session_binding_unverifiable')
  }
  if (record.handle && record.handle !== observed.terminalHandle) {
    throw new Error('session_binding_unverifiable')
  }

  const parsed = parsePaneKey(row.paneKey)
  if (!parsed || pty.tabId !== parsed.tabId) {
    throw new Error('session_binding_unverifiable')
  }
  if (row.tabId && row.tabId !== parsed.tabId) {
    throw new Error('session_binding_unverifiable')
  }
  if (row.worktreeId && row.worktreeId !== pty.worktreeId) {
    throw new Error('session_binding_unverifiable')
  }

  const leaf = host.getRendererLeaf(parsed.tabId, parsed.leafId)
  if (
    !leaf ||
    leaf.tabId !== parsed.tabId ||
    leaf.leafId !== parsed.leafId ||
    leaf.ptyId !== pty.ptyId ||
    leaf.worktreeId !== pty.worktreeId
  ) {
    throw new Error('session_binding_unverifiable')
  }

  if (target.workspace) {
    const resolved = await host.resolveWorktree(pty.worktreeId)
    if (!resolved) {
      throw new Error('session_binding_unverifiable')
    }
    const match =
      target.workspace === resolved.id ||
      target.workspace === resolved.path ||
      ('rootPath' in resolved && target.workspace === resolved.rootPath)
    if (!match) {
      throw new Error('session_binding_unverifiable')
    }
  }

  return {
    provider: target.provider,
    sessionId: target.session,
    paneKey: row.paneKey,
    handle: observed.terminalHandle,
    processIncarnation: observed.processIncarnation,
    ptyId: pty.ptyId,
    incarnationId: pty.incarnationId,
    tabId: parsed.tabId,
    leafId: parsed.leafId,
    worktreeId: pty.worktreeId
  }
}

export function verifyOriginatingPaneIdentity(
  host: TerminalOriginatingPaneHost,
  candidate: OriginatingPaneCandidate
): boolean {
  const observed = host.readObservedAgentStatusPaneIdentity(candidate.paneKey)
  if (
    !observed ||
    observed.kind !== 'observed' ||
    observed.terminalHandle !== candidate.handle ||
    observed.processIncarnation !== candidate.processIncarnation
  ) {
    return false
  }

  const live = host.getLivePtyForHandle(candidate.handle)
  if (!live) {
    return false
  }
  const pty = live.pty
  if (
    !pty.connected ||
    pty.connectionId !== null ||
    pty.isWsl === true ||
    pty.ptyId !== candidate.ptyId ||
    pty.incarnationId !== candidate.incarnationId ||
    pty.paneKey !== candidate.paneKey ||
    pty.tabId !== candidate.tabId ||
    pty.worktreeId !== candidate.worktreeId ||
    `${pty.ptyId}:${pty.incarnationId}` !== candidate.processIncarnation
  ) {
    return false
  }

  const leaf = host.getRendererLeaf(candidate.tabId, candidate.leafId)
  if (
    !leaf ||
    leaf.tabId !== candidate.tabId ||
    leaf.leafId !== candidate.leafId ||
    leaf.ptyId !== candidate.ptyId ||
    leaf.worktreeId !== candidate.worktreeId
  ) {
    return false
  }

  const matchingRows = host
    .getAgentStatusSnapshot()
    .filter(
      (row) =>
        row.agentType === candidate.provider && row.providerSession?.id === candidate.sessionId
    )
  if (matchingRows.length !== 1) {
    return false
  }
  const statusRow = matchingRows[0]
  if (
    statusRow.paneKey !== candidate.paneKey ||
    statusRow.connectionId !== null ||
    statusRow.providerSessionOnly === true ||
    statusRow.restoredUnconfirmed === true ||
    statusRow.observation?.origin !== 'hook' ||
    statusRow.observation.kind !== 'transition' ||
    (statusRow.terminalHandle !== undefined && statusRow.terminalHandle !== candidate.handle) ||
    (statusRow.tabId !== undefined && statusRow.tabId !== candidate.tabId) ||
    (statusRow.worktreeId !== undefined && statusRow.worktreeId !== candidate.worktreeId)
  ) {
    return false
  }
  try {
    checkRowFreshness(statusRow, host.now ? host.now() : Date.now())
  } catch {
    return false
  }
  return true
}

export async function switchOriginatingPaneWithHost(
  host: TerminalOriginatingPaneHost,
  target: OriginatingPaneTarget,
  options: { activateHostWindow?: boolean } = {}
): Promise<OriginatingPaneNavigationReceipt> {
  const candidate = await selectOriginatingPaneCandidate(host, target)
  if (!verifyOriginatingPaneIdentity(host, candidate)) {
    throw new Error('session_navigation_unverifiable')
  }
  let receipt: {
    navigated: boolean
    tabId?: string
    worktreeId?: string
    identity?: TerminalRevealIdentity
    windowFocused?: boolean
    paneFocused?: boolean
  }
  try {
    receipt = await host.focusTerminal(candidate.handle, {
      expectedIncarnationId: candidate.incarnationId,
      existingSessionOnly: true,
      verifySession: () => verifyOriginatingPaneIdentity(host, candidate),
      activateHostWindow: options.activateHostWindow === true
    })
  } catch {
    throw new Error('session_navigation_unverifiable')
  }

  if (
    receipt.navigated !== true ||
    !receipt.identity ||
    receipt.identity.ptyId !== candidate.ptyId ||
    receipt.identity.tabId !== candidate.tabId ||
    receipt.identity.leafId !== candidate.leafId ||
    receipt.identity.worktreeId !== candidate.worktreeId ||
    (receipt.tabId !== undefined && receipt.tabId !== candidate.tabId) ||
    (receipt.worktreeId !== undefined && receipt.worktreeId !== candidate.worktreeId) ||
    !verifyOriginatingPaneIdentity(host, candidate)
  ) {
    throw new Error('session_navigation_unverifiable')
  }

  return {
    provider: candidate.provider,
    sessionId: candidate.sessionId,
    handle: candidate.handle,
    tabId: candidate.tabId,
    leafId: candidate.leafId,
    worktreeId: candidate.worktreeId,
    ptyId: candidate.ptyId,
    incarnationId: candidate.incarnationId,
    navigated: true,
    ...(receipt.windowFocused !== undefined ? { windowFocused: receipt.windowFocused } : {}),
    ...(receipt.paneFocused !== undefined ? { paneFocused: receipt.paneFocused } : {})
  }
}
