import {
  createAutomationRunOutputSnapshotBuffer,
  selectAutomationRunOutputSnapshot
} from '@/components/automations/automation-run-output-snapshot'
import { useAppStore } from '@/store'
import type {
  AutomationDispatchResult,
  AutomationPrecheckResult,
  AutomationRun
} from '../../../shared/automations-types'
import type { AgentStateHistoryEntry, AgentStatusEntry } from '../../../shared/agent-status-types'
import {
  selectAutomationAgentStatusEntryChange,
  UNCHANGED_AUTOMATION_AGENT_STATUS_ENTRY
} from './automation-agent-status-entry-change'
import type { Worktree } from '../../../shared/worktree/types'
import { isProvenProcessExit } from '../../../shared/terminal-exit-cause'
import { waitForAutomationSessionHistoryFlush } from './automation-session-history-flush'
import { automationAgentCompletionResult } from '../../../shared/automation-agent-completion-result'
import type { AgentMainAgentVerdictSource } from '../../../shared/agent-main-agent-verdict'
import { getAgentStateHistoryOverlap } from './automation-agent-state-history-overlap'

type MarkDispatchResult = (result: AutomationDispatchResult) => Promise<void>

export function createAutomationDispatchCompletion(args: {
  run: AutomationRun
  worktree: Worktree
  precheckResult: AutomationPrecheckResult | null
  markDispatchResult: MarkDispatchResult
  releaseTerminalOwnership: () => void
  finalizeTerminalOwnership: () => boolean | Promise<boolean>
}) {
  const outputSnapshotBuffer = createAutomationRunOutputSnapshotBuffer()
  let latestAssistantMessage: string | null = null
  const getOutputSnapshot = () =>
    selectAutomationRunOutputSnapshot(latestAssistantMessage, outputSnapshotBuffer.snapshot())
  let dispatchMarked = false
  let pendingExitCode: number | null = null
  let pendingDone = false
  let pendingDoneRow: AgentMainAgentVerdictSource | undefined
  let completionMarked = false
  let contactLost = false
  let observedPaneKey = args.run.terminalPaneKey
  let unsubscribeAgentStatus = (): void => {}
  let unsubscribeSessionObserver = (): void => {}
  let releaseReuseDispatchTab = (): void => {}
  const cleanupRunObservers = (): void => {
    unsubscribeAgentStatus()
    unsubscribeSessionObserver()
    releaseReuseDispatchTab()
    unsubscribeAgentStatus = (): void => {}
    unsubscribeSessionObserver = (): void => {}
    releaseReuseDispatchTab = (): void => {}
  }
  const markCompletionResult = async (row?: AgentMainAgentVerdictSource): Promise<void> => {
    if (completionMarked) {
      return
    }
    completionMarked = true
    cleanupRunObservers()
    const providerSessionId = readProviderSessionId(observedPaneKey)
    const result = automationAgentCompletionResult(row)
    try {
      await args.markDispatchResult({
        runId: args.run.id,
        ...result,
        workspaceId: args.worktree.id,
        workspaceDisplayName: args.worktree.displayName,
        outputSnapshot: getOutputSnapshot(),
        precheckResult: args.precheckResult,
        ...(providerSessionId ? { providerSessionId } : {})
      })
    } catch (error) {
      args.releaseTerminalOwnership()
      throw error
    }
    await waitForAutomationSessionHistoryFlush(observedPaneKey)
    if (result.status === 'dispatch_failed') {
      args.releaseTerminalOwnership()
    } else if (await args.finalizeTerminalOwnership()) {
      await clearRetiredRunTerminalIdentity()
    }
    await persistLateProviderSessionId(providerSessionId, result.status)
  }
  const persistLateProviderSessionId = async (
    alreadyPersisted: string | null,
    status: 'completed' | 'dispatch_failed' = 'completed'
  ): Promise<void> => {
    const lateId = readProviderSessionId(observedPaneKey)
    if (!lateId || lateId === alreadyPersisted) {
      return
    }
    try {
      await args.markDispatchResult({
        runId: args.run.id,
        status,
        providerSessionId: lateId
      })
    } catch (error) {
      console.error('[automations] Failed to persist late provider session:', error)
    }
  }
  const clearRetiredRunTerminalIdentity = async (): Promise<void> => {
    // Why: closeTab already removed the tab. Null only the live PTY so View run
    // (pane-mounted) is not offered. Keep paneKey/sessionId so Resume can remount
    // the original leaf and `--resume` the persisted provider session.
    try {
      await args.markDispatchResult({
        runId: args.run.id,
        status: 'completed',
        terminalPtyId: null
      })
    } catch (error) {
      console.error('[automations] Failed to clear retired terminal identity:', error)
    }
  }
  /**
   * A lost PTY is not a result. Record nothing: the run keeps its non-final
   * `dispatched` status, so it is never evicted from history and never shown as
   * Failed for work that is very likely still running (on SSH, a relay whose
   * reattach failed). Ownership of an unobservable run belongs to main's
   * AutomationRunCompletionWatcher, which reports the truthful "lost the
   * terminal for this run" instead of an exit code nobody witnessed.
   *
   * `finalize()` is deliberately never reached here — closing the terminal of a
   * process we cannot prove dead is what orphans live work.
   */
  const abandonUnverifiableRun = (code: number): void => {
    if (completionMarked || contactLost) {
      return
    }
    contactLost = true
    cleanupRunObservers()
    args.releaseTerminalOwnership()
    console.warn(
      `[automations] Lost contact with the process for run ${args.run.id} (code ${code}); leaving the run dispatched rather than reporting an exit.`
    )
  }
  const markExitResult = async (code: number): Promise<void> => {
    if (completionMarked) {
      return
    }
    if (!isProvenProcessExit(code)) {
      abandonUnverifiableRun(code)
      return
    }
    completionMarked = true
    cleanupRunObservers()
    const providerSessionId = readProviderSessionId(observedPaneKey)
    try {
      await args.markDispatchResult({
        runId: args.run.id,
        status: code === 0 ? 'completed' : 'dispatch_failed',
        workspaceId: args.worktree.id,
        workspaceDisplayName: args.worktree.displayName,
        outputSnapshot: getOutputSnapshot(),
        precheckResult: args.precheckResult,
        error: code === 0 ? null : `Automation process exited with code ${code}.`,
        ...(providerSessionId ? { providerSessionId } : {})
      })
    } catch (error) {
      args.releaseTerminalOwnership()
      throw error
    }
    if (code === 0) {
      if (await args.finalizeTerminalOwnership()) {
        await clearRetiredRunTerminalIdentity()
      }
      await persistLateProviderSessionId(providerSessionId)
    } else {
      args.releaseTerminalOwnership()
    }
  }
  const settleLateResult = (result: Promise<void>): void => {
    // Why: status/exit callbacks have no awaitable caller; the result
    // path already releases ownership before propagating persistence errors.
    void result.catch((error) => {
      console.error('[automations] Failed to persist late automation result:', error)
    })
  }
  const handleAgentDone = (row?: AgentMainAgentVerdictSource): void => {
    if (completionMarked) {
      return
    }
    if (!dispatchMarked) {
      pendingDone = true
      pendingDoneRow = row
      return
    }
    settleLateResult(markCompletionResult(row))
  }
  const handleExit = (code: number): void => {
    if (completionMarked) {
      return
    }
    if (!dispatchMarked) {
      pendingExitCode = code
      return
    }
    settleLateResult(markExitResult(code))
  }
  const observeAgentStatus = (
    targetPaneKey: string,
    startedAfter: number,
    options?: { requireWorkingAfterStart?: boolean }
  ): void => {
    observedPaneKey = targetPaneKey
    let sawWorkingAfterStart = false
    let observedStateHistory: AgentStateHistoryEntry[] = []
    let observedEntry: AgentStatusEntry | undefined
    const checkCurrentStatus = (): void => {
      const entryChange = selectAutomationAgentStatusEntryChange(
        useAppStore.getState().agentStatusByPaneKey,
        targetPaneKey,
        observedEntry
      )
      if (entryChange === UNCHANGED_AUTOMATION_AGENT_STATUS_ENTRY) {
        return
      }
      const entry = entryChange
      observedEntry = entry
      if (!entry || entry.updatedAt < startedAfter) {
        return
      }
      const historyOverlap = getAgentStateHistoryOverlap(observedStateHistory, entry.stateHistory)
      // Why: sawWorkingAfterStart stays monotonic — a recreated entry
      // (transport loss, PTY exit, cap eviction) arrives with an empty
      // stateHistory, so clearing it here would strand reuseSession runs
      // with nothing left to re-derive the working edge from.
      for (const historicalState of entry.stateHistory.slice(historyOverlap)) {
        if (historicalState.startedAt < startedAfter) {
          continue
        }
        if (historicalState.state === 'working') {
          sawWorkingAfterStart = true
        }
        if (
          historicalState.state === 'done' &&
          (!options?.requireWorkingAfterStart || sawWorkingAfterStart)
        ) {
          // Why: this `done` already rolled out of the live entry, so its output
          // survives only in the entry-level completed slot.
          latestAssistantMessage = entry.lastCompletedAssistantMessage?.trim() || null
          handleAgentDone(historicalState)
          return
        }
      }
      observedStateHistory = [...entry.stateHistory]
      if (entry.state === 'working') {
        sawWorkingAfterStart = true
      }
      if (
        entry.state === 'done' &&
        // Why: a session-boundary done is the agent CONNECTING (Claude SessionStart
        // fires at launch, before the argv prompt submits) — completing here would
        // close the tab and record an empty run result.
        entry.sessionBoundary !== true &&
        (!options?.requireWorkingAfterStart || sawWorkingAfterStart)
      ) {
        latestAssistantMessage = entry.lastAssistantMessageIsToolOutput
          ? null
          : entry.lastAssistantMessage?.trim() || latestAssistantMessage
        handleAgentDone(entry)
      }
    }
    // Why: Codex/Claude completion normally arrives through the global
    // hook IPC listener, not the hidden PTY OSC fallback.
    unsubscribeAgentStatus = useAppStore.subscribe(checkCurrentStatus)
    checkCurrentStatus()
  }

  return {
    appendOutput: (chunk: string) => outputSnapshotBuffer.append(chunk),
    captureAssistantMessage: (message: string | null | undefined, isToolOutput?: boolean) => {
      latestAssistantMessage = isToolOutput ? null : message?.trim() || latestAssistantMessage
    },
    cleanupRunObservers,
    handleAgentDone,
    handleExit,
    observeAgentStatus,
    setReuseDispatchTabRelease: (release: () => void) => {
      releaseReuseDispatchTab = release
    },
    setSessionObserver: (unsubscribe: () => void) => {
      unsubscribeSessionObserver = unsubscribe
    },
    settlePendingAfterDispatch: async () => {
      dispatchMarked = true
      if (pendingDone) {
        await markCompletionResult(pendingDoneRow)
      } else if (pendingExitCode !== null) {
        await markExitResult(pendingExitCode)
      }
    }
  }
}

function readProviderSessionId(paneKey: string | null | undefined): string | null {
  if (!paneKey) {
    return null
  }
  const state = useAppStore.getState()
  return (
    state.agentStatusByPaneKey?.[paneKey]?.providerSession?.id?.trim() ||
    state.sleepingAgentSessionsByPaneKey?.[paneKey]?.providerSession?.id?.trim() ||
    null
  )
}
