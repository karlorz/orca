import type { AgentSessionControlReceipt } from './agent-session-bound-control'
import type { AgentJournalSubmission } from './agent-session-journal-types'
import type { AgentSessionQueuedSendReceipt } from './agent-session-wire'

export type AgentSessionSendResult =
  | {
      clientMessageId: string
      submission: AgentJournalSubmission
      controlReceipt?: AgentSessionControlReceipt
    }
  | { clientMessageId: string; queued: AgentSessionQueuedSendReceipt }

/** The submission arm's payload; undefined for a queued answer. For callers that
 *  never send `delivery` the queued arm cannot arrive, and `undefined` reads as
 *  delivery-unknown rather than as an error. */
export function agentSessionSendSubmission(
  result: AgentSessionSendResult | undefined
): AgentJournalSubmission | undefined {
  return result !== undefined && 'submission' in result ? result.submission : undefined
}

export type AgentSessionCancelResult = {
  /** The turn the client named, echoed so a late reply can be matched; absent when it named none. */
  turnId?: string
  cancelled: boolean
  controlReceipt?: AgentSessionControlReceipt
}
