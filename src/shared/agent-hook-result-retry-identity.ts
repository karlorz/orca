import type { AgentHookEventPayload } from './agent-hook-listener/listener-event'
import { isSameAgentProcess } from './agent-process-presence'

type RetryRow = AgentHookEventPayload & { turnStartedAt?: number }

export function agentHookResultRetryMatchesTurn(original: RetryRow, current: RetryRow): boolean {
  if (current === original) {
    return true
  }
  const originalProcess = original.agentPresence?.process
  const currentProcess = current.agentPresence?.process
  return (
    original.payload.agentType === 'grok' &&
    current.payload.agentType === 'grok' &&
    Boolean(original.providerPromptId) &&
    original.providerPromptId === current.providerPromptId &&
    Boolean(original.providerSession?.id) &&
    original.providerSession?.id === current.providerSession?.id &&
    original.providerSession?.key === current.providerSession?.key &&
    original.paneKey === current.paneKey &&
    original.worktreeId === current.worktreeId &&
    original.tabId === current.tabId &&
    original.connectionId === current.connectionId &&
    original.launchToken === current.launchToken &&
    original.terminalHandle === current.terminalHandle &&
    original.hostTurnRevision === current.hostTurnRevision &&
    original.turnStartedAt === current.turnStartedAt &&
    current.agentPresence?.ended !== true &&
    ((!originalProcess && !currentProcess) ||
      Boolean(
        originalProcess && currentProcess && isSameAgentProcess(originalProcess, currentProcess)
      )) &&
    current.isReplay !== true &&
    current.restoredUnconfirmed !== true &&
    current.providerSessionOnly !== true &&
    current.hookEventName !== 'UserPromptSubmit' &&
    (original.payload.mainAgent?.state ?? original.payload.state) === 'done' &&
    (current.payload.mainAgent?.state ?? current.payload.state) === 'done'
  )
}
