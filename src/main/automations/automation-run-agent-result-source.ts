import type { AutomationAssistantResult } from '../../shared/automation-assistant-result-types'
import type { AgentHookServer } from '../agent-hooks/server'
import type { AgentStatusIpcPayload } from '../../shared/agent-status-types'
import { toAgentStatusIpcPayload } from '../agent-hooks/server/server-status-identity'

export type AutomationAgentResultStatus = AgentStatusIpcPayload & {
  automationAssistantResult?: AutomationAssistantResult
  providerPromptId?: string
  isReplay?: boolean
}

export type AutomationAgentResultSource = {
  readPane: (paneKey: string) => readonly AutomationAgentResultStatus[]
  subscribe: (listener: (row: AutomationAgentResultStatus) => void) => () => void
  subscribeClear: (listener: (paneKey: string) => void) => () => void
}

export function createAutomationAgentResultSource(
  server: Pick<
    AgentHookServer,
    | 'getAutomationResultRowsForPane'
    | 'subscribeEnrichedStatus'
    | 'subscribePaneStatusClear'
    | 'subscribeStatusDrop'
  >
): AutomationAgentResultSource {
  return {
    readPane: (paneKey) =>
      server.getAutomationResultRowsForPane(paneKey).map((event) => ({
        ...toAgentStatusIpcPayload(event),
        providerPromptId: event.providerPromptId,
        automationAssistantResult: event.automationAssistantResult,
        isReplay: event.isReplay
      })),
    subscribe: (listener) =>
      server.subscribeEnrichedStatus((event) =>
        listener({
          ...toAgentStatusIpcPayload(event),
          automationAssistantResult: event.automationAssistantResult,
          providerPromptId: event.providerPromptId,
          isReplay: event.isReplay
        })
      ),
    subscribeClear: (listener) => {
      const clear = server.subscribePaneStatusClear((event) => {
        if ('paneKey' in event) {
          listener(event.paneKey)
        }
      })
      const drop = server.subscribeStatusDrop(listener)
      return () => {
        clear()
        drop()
      }
    }
  }
}
