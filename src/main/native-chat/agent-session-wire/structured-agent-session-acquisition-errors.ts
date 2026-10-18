import type { AgentSessionAccountKind } from '../../../shared/agent-session-availability'
import type { AgentSessionRefusalReason } from '../../../shared/agent-session-wire-refusals'

// How an acquisition that failed after spawn ended, as far as cleanup could prove it.

/**
 * The provider's own root process was observed to exit, but its descendant tree
 * was not proven gone. The lease keys on the root's pid and start time, so its
 * observed death releases the reservation; nothing is claimed about descendants,
 * including one seen still alive.
 */
export class AgentSessionAcquisitionRootExitObservedError extends Error {
  constructor(cause: unknown) {
    // The provider's own diagnostic is the only thing the user can act on.
    super(cause instanceof Error ? cause.message : String(cause), { cause })
    this.name = 'AgentSessionAcquisitionRootExitObservedError'
  }
}

/** The provider child failed and cleanup proved its whole tree gone — on Windows, that its root
 *  left on its own after stdin end (descendants not addressed, as with Codex) or taskkill reported
 *  the tree terminated. As with a root exit, the provider's own diagnostic is the message. */
export class AgentSessionAcquisitionExitProvenError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause })
    this.name = 'AgentSessionAcquisitionExitProvenError'
  }
}

export class AgentSessionAcquisitionExitUnprovenError extends Error {
  constructor(cause: unknown) {
    super('agent_session_acquisition_exit_unproven', { cause })
    this.name = 'AgentSessionAcquisitionExitUnprovenError'
  }
}

export class AgentSessionAcquisitionRefusal extends Error {
  readonly code = 'agent_session_operation_invalid'

  constructor(
    message: string,
    /** The situation, so the chat can say what to do; the message is Orca's log wording. Absent,
     *  the provider refused its own start. */
    readonly reason: AgentSessionRefusalReason<'agent_session_operation_invalid'> = 'providerStartFailed',
    readonly account?: AgentSessionAccountKind
  ) {
    super(message)
    this.name = 'AgentSessionAcquisitionRefusal'
  }

  /** The conversation's history is more than this host can restore. */
  static historyTooLarge(message: string): AgentSessionAcquisitionRefusal {
    return new AgentSessionAcquisitionRefusal(message, 'historyTooLarge')
  }
}

export class AgentSessionPromptUnavailableError extends Error {
  constructor(itemId: string) {
    super(`The provider is no longer waiting on ${itemId}.`)
    this.name = 'AgentSessionPromptUnavailableError'
  }
}

/** The provider cannot take this answer. Thrown before the journal commit, so nothing is recorded. */
export class AgentSessionPromptAnswerRejectedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentSessionPromptAnswerRejectedError'
  }
}
