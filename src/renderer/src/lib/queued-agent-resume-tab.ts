import type { AppState } from '@/store/types'
import {
  agentProviderSessionsEqual,
  type SleepingAgentSessionRecord
} from '../../../shared/agent-session-resume'

export type QueuedAgentResumeState = {
  tabsByWorktree: Record<string, readonly { id: string }[]>
  pendingStartupByTabId: Record<
    string,
    Pick<AppState['pendingStartupByTabId'][string], 'launchAgent' | 'resumeProviderSession'>
  >
  automaticAgentResumeClaimsByTabId: AppState['automaticAgentResumeClaimsByTabId']
}

export function findQueuedAgentResumeTab(
  record: Pick<SleepingAgentSessionRecord, 'worktreeId' | 'agent' | 'providerSession'>,
  state: QueuedAgentResumeState
): string | null {
  const tabIds = new Set((state.tabsByWorktree[record.worktreeId] ?? []).map((tab) => tab.id))
  for (const [tabId, startup] of Object.entries(state.pendingStartupByTabId)) {
    if (
      tabIds.has(tabId) &&
      startup.launchAgent === record.agent &&
      agentProviderSessionsEqual(
        record.agent,
        startup.resumeProviderSession,
        record.providerSession
      )
    ) {
      return tabId
    }
  }
  for (const [tabId, claim] of Object.entries(state.automaticAgentResumeClaimsByTabId)) {
    if (
      tabIds.has(tabId) &&
      claim.worktreeId === record.worktreeId &&
      claim.launchAgent === record.agent &&
      agentProviderSessionsEqual(record.agent, claim.providerSession, record.providerSession)
    ) {
      return tabId
    }
  }
  return null
}
