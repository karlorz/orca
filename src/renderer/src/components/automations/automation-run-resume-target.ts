import type { AppState } from '@/store/types'
import {
  findQueuedAgentResumeTab,
  type QueuedAgentResumeState
} from '@/lib/queued-agent-resume-tab'
import { stablePaneHasLivePty } from '@/lib/sleeping-agent-pane-ownership'
import {
  agentProviderSessionsEqual,
  type SleepingAgentSessionRecord
} from '../../../../shared/agent-session-resume'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import { isAutomationRunPaneMounted } from './automation-run-open-target'

export type AutomationRunResumeState = QueuedAgentResumeState & {
  agentStatusByPaneKey: Record<
    string,
    Pick<
      AppState['agentStatusByPaneKey'][string],
      'paneKey' | 'tabId' | 'worktreeId' | 'agentType' | 'providerSession'
    >
  >
  ptyIdsByTabId: AppState['ptyIdsByTabId']
  terminalLayoutsByTabId: AppState['terminalLayoutsByTabId']
  sleepingAgentSessionsByPaneKey: AppState['sleepingAgentSessionsByPaneKey']
}

export function findAutomationRunResumeTarget(
  record: SleepingAgentSessionRecord,
  state: AutomationRunResumeState
): { tabId: string; leafId?: string } | null {
  const tabIds = new Set((state.tabsByWorktree[record.worktreeId] ?? []).map((tab) => tab.id))
  for (const entry of Object.values(state.agentStatusByPaneKey)) {
    const pane = parsePaneKey(entry.paneKey)
    if (
      pane &&
      tabIds.has(pane.tabId) &&
      (!entry.tabId || entry.tabId === pane.tabId) &&
      (!entry.worktreeId || entry.worktreeId === record.worktreeId) &&
      entry.agentType === record.agent &&
      agentProviderSessionsEqual(record.agent, entry.providerSession, record.providerSession) &&
      stablePaneHasLivePty(
        pane.tabId,
        pane.leafId,
        state.ptyIdsByTabId,
        state.terminalLayoutsByTabId[pane.tabId]
      )
    ) {
      return { tabId: pane.tabId, leafId: pane.leafId }
    }
  }
  for (const sleeping of Object.values(state.sleepingAgentSessionsByPaneKey)) {
    const pane = parsePaneKey(sleeping.paneKey)
    if (
      pane &&
      sleeping.worktreeId === record.worktreeId &&
      sleeping.agent === record.agent &&
      agentProviderSessionsEqual(record.agent, sleeping.providerSession, record.providerSession) &&
      isAutomationRunPaneMounted({
        run: { terminalPaneKey: sleeping.paneKey },
        terminalTabExists: tabIds.has(pane.tabId),
        currentLayout: state.terminalLayoutsByTabId[pane.tabId]
      })
    ) {
      return { tabId: pane.tabId, leafId: pane.leafId }
    }
  }
  const queuedTabId = findQueuedAgentResumeTab(record, state)
  return queuedTabId ? { tabId: queuedTabId } : null
}
