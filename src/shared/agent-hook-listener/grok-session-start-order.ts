import type { AgentHookEventPayload } from './listener-event'
import { isGrokEvent } from './provider-event-names'

type SessionStartIdentity = Pick<
  AgentHookEventPayload,
  | 'source'
  | 'hookEventName'
  | 'paneKey'
  | 'tabId'
  | 'worktreeId'
  | 'connectionId'
  | 'launchToken'
  | 'providerSession'
>

// Why: Grok can finish its startup hook after submitting the first prompt in the same launch.
export function isLateGrokSessionStart(
  previous: AgentHookEventPayload | undefined,
  incoming: SessionStartIdentity
): boolean {
  return (
    previous?.source === 'grok' &&
    previous.grokPromptBoundary === true &&
    previous.isReplay !== true &&
    previous.restoredUnconfirmed !== true &&
    previous.providerSessionOnly !== true &&
    previous.agentPresence?.ended !== true &&
    incoming.source === 'grok' &&
    isGrokEvent(incoming.hookEventName, 'session_start') &&
    Boolean(incoming.launchToken) &&
    incoming.launchToken === previous.launchToken &&
    incoming.paneKey === previous.paneKey &&
    incoming.tabId === previous.tabId &&
    incoming.worktreeId === previous.worktreeId &&
    incoming.connectionId === previous.connectionId &&
    Boolean(incoming.providerSession?.id) &&
    incoming.providerSession?.id === previous.providerSession?.id &&
    incoming.providerSession?.key === previous.providerSession?.key
  )
}
