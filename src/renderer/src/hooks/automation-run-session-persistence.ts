import { useAppStore } from '@/store'
import type { AutomationDispatchResult } from '../../../shared/automations-types'
import type { automationAgentCompletionResult } from '../../../shared/automation-agent-completion-result'

export function createAutomationRunSessionPersistence(args: {
  runId: string
  getPaneKey: () => string | null | undefined
  markDispatchResult: (result: AutomationDispatchResult) => Promise<void>
}) {
  const readProviderSessionId = (): string | null => {
    const paneKey = args.getPaneKey()
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
  return {
    readProviderSessionId,
    persistLateProviderSessionId: async (
      alreadyPersisted: string | null,
      result: ReturnType<typeof automationAgentCompletionResult>
    ): Promise<void> => {
      const lateId = readProviderSessionId()
      if (!lateId || lateId === alreadyPersisted) {
        return
      }
      try {
        await args.markDispatchResult({ runId: args.runId, ...result, providerSessionId: lateId })
      } catch (error) {
        console.error('[automations] Failed to persist late provider session:', error)
      }
    },
    clearRetiredRunTerminalIdentity: async (): Promise<void> => {
      try {
        await args.markDispatchResult({
          runId: args.runId,
          status: 'completed',
          terminalPtyId: null
        })
      } catch (error) {
        console.error('[automations] Failed to clear retired terminal identity:', error)
      }
    }
  }
}
