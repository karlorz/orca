import type { AutomationRun } from '../../shared/automations-types'
import type { AgentStatusIpcPayload } from '../../shared/agent-status-types'
import { selectFreshExplicitAgentStatusRow } from '../runtime/runtime-hook-agent-row-selection'
import { automationAgentCompletionResult } from '../../shared/automation-agent-completion-result'

export function readAutomationRunAgentCompletion(
  run: AutomationRun,
  handle: string,
  rows: readonly AgentStatusIpcPayload[]
): ReturnType<typeof automationAgentCompletionResult> | undefined {
  const row = selectFreshExplicitAgentStatusRow({
    handles: [handle],
    paneKeys: run.terminalPaneKey ? [run.terminalPaneKey] : [],
    hookRows: rows
  })
  const startedAt = run.startedAt ?? run.dispatchedAt ?? run.createdAt
  if (
    !row ||
    row.sessionBoundary === true ||
    (row.evidenceObservedAt ?? row.receivedAt) < startedAt ||
    (row.mainAgent?.stateStartedAt ?? row.stateStartedAt) < startedAt ||
    (row.mainAgent?.state ?? row.state) !== 'done' ||
    (row.worktreeId && row.worktreeId !== run.workspaceId) ||
    (row.terminalHandle && row.terminalHandle !== handle) ||
    (run.providerSessionId &&
      row.providerSession?.id &&
      row.providerSession.id !== run.providerSessionId)
  ) {
    return undefined
  }
  return automationAgentCompletionResult(row)
}
