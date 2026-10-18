import type { AgentSessionControlTarget } from '../../../shared/agent-session-bound-control'
import type { StructuredConversationCommandController } from './structured-conversation-command-controller'
import type { StructuredAgentSessionMutationContext } from './structured-agent-session-mutation-context'
import type { StructuredAgentSessionSendSettlement } from './structured-agent-session-send-settlement'
import type { StructuredAgentSessionCaller } from './structured-agent-session-host-types'
import { structuredAgentSessionMutationDelegates } from './structured-agent-session-host-mutations'
import { StructuredAgentSessionBoundControls } from './structured-agent-session-bound-controls'

export function wireStructuredAgentSessionBoundControls(
  context: () => StructuredAgentSessionMutationContext,
  waitForSendSettlement: StructuredAgentSessionSendSettlement['wait'],
  legacySend: StructuredConversationCommandController['send']
) {
  const controls = new StructuredAgentSessionBoundControls(context, waitForSendSettlement)
  const mutations = structuredAgentSessionMutationDelegates(context)
  const legacyCancel = mutations.cancel
  return {
    ...mutations,
    controlTarget: controls.targets.resolve,
    send: (
      caller: StructuredAgentSessionCaller,
      params: Parameters<typeof legacySend>[1] & {
        expectedControlTarget?: AgentSessionControlTarget
      }
    ) =>
      params.expectedControlTarget
        ? controls.send(caller, { ...params, expectedControlTarget: params.expectedControlTarget })
        : legacySend(caller, params),
    cancel: (
      caller: StructuredAgentSessionCaller,
      params: Parameters<typeof legacyCancel>[1] & {
        expectedControlTarget?: AgentSessionControlTarget
      }
    ) =>
      params.expectedControlTarget
        ? controls.cancel(caller, {
            ...params,
            expectedControlTarget: params.expectedControlTarget
          })
        : legacyCancel(caller, params)
  }
}
