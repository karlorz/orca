import { resolveAgentStatusIdentity } from '../agent-status-identity'
import { sameAgentStatusTerminalOwner } from '../agent-status-terminal-owner'
import type { AgentHookSource } from '../agent-hook-relay'
import type { AgentHookEventPayload } from './listener-event'

export function isHookFromInheritedAgent(
  previous: AgentHookEventPayload | undefined,
  source: AgentHookSource,
  worktreeId: string | undefined
): boolean {
  const receivedAt =
    previous && 'receivedAt' in previous && typeof previous.receivedAt === 'number'
      ? previous.receivedAt
      : previous?.hostEvidenceObservedAt
  return Boolean(
    previous &&
    receivedAt !== undefined &&
    sameAgentStatusTerminalOwner(
      { connectionId: previous.connectionId ?? null, worktreeId: previous.worktreeId },
      { connectionId: null, worktreeId }
    ) &&
    resolveAgentStatusIdentity({
      existing: {
        agentType: previous.payload.agentType,
        state: previous.payload.state,
        updatedAt: receivedAt,
        restoredUnconfirmed: previous.restoredUnconfirmed,
        agentPresence: previous.providerSessionOnly ? undefined : previous.agentPresence
      },
      incoming: source,
      now: Date.now()
    }).inheritedFromActivePane
  )
}
