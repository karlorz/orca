import { reconcileRemoteCodexState } from '../../../shared/agent-hook-listener/providers/codex-state'
import type { HookListenerState } from '../../../shared/agent-hook-listener/listener-state'
import type { AgentHookEventPayload } from '../../../shared/agent-hook-listener/listener-event'

export function withReconciledCodexRootContext<T extends AgentHookEventPayload>(
  state: HookListenerState,
  payload: T,
  previous: AgentHookEventPayload | undefined
): T {
  const stateReconciledPayload =
    (payload.connectionId || !payload.hookEventName) &&
    payload.payload.agentType === 'codex' &&
    (payload.hookEventName || payload.payload.mainAgent)
      ? {
          ...payload,
          payload: reconcileRemoteCodexState(
            state,
            payload.paneKey,
            payload.hookEventName,
            payload.toolAgentId,
            payload.payload,
            previous?.payload
          )
        }
      : payload
  const previousCodexRoot =
    stateReconciledPayload.payload.agentType === 'codex' &&
    stateReconciledPayload.toolAgentId &&
    previous?.payload.agentType === 'codex'
      ? previous
      : undefined
  const preservedProviderSession = !stateReconciledPayload.providerSession
    ? previousCodexRoot?.providerSession
    : undefined
  const preservedRootModel = !stateReconciledPayload.payload.model
    ? previousCodexRoot?.payload.model
    : undefined
  // Relay restart loses root context; child hooks must not erase persisted resume/model identity.
  if (!preservedProviderSession && !preservedRootModel) {
    return stateReconciledPayload
  }
  return {
    ...stateReconciledPayload,
    ...(preservedProviderSession ? { providerSession: preservedProviderSession } : {}),
    payload: preservedRootModel
      ? { ...stateReconciledPayload.payload, model: preservedRootModel }
      : stateReconciledPayload.payload
  }
}
