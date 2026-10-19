import {
  AGENT_HOOK_NOTIFICATION_METHOD,
  type AgentHookRelayEnvelope
} from '../shared/agent-hook-relay'
import type { RelayDispatcher } from './dispatcher'

export function fitAutomationResultEnvelope(
  dispatcher: RelayDispatcher,
  envelope: AgentHookRelayEnvelope
): AgentHookRelayEnvelope {
  // Optional full prose must never crowd out status or the bounded preview.
  return envelope.automationAssistantResult &&
    dispatcher.producerEnvelopeBudget(AGENT_HOOK_NOTIFICATION_METHOD, { ...envelope }) < 0
    ? { ...envelope, automationAssistantResult: undefined }
    : envelope
}
