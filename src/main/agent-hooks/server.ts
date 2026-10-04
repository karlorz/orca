// This main-process adapter keeps listener internals in shared/ so the relay can host the same pipeline without Electron.
import { clearAllListenerCaches } from '../../shared/agent-hook-listener/listener-state'
import { normalizeHookPayload } from '../../shared/agent-hook-listener'
import { parseFormEncodedBody } from '../../shared/agent-hook-listener/request-body'
import type { AgentHookEventPayload } from '../../shared/agent-hook-listener/listener-event'
import type { AgentHookSource } from '../../shared/agent-hook-relay'
import { AgentHookServerAgentPresence } from './server/server-agent-presence'
import { isValidPaneKey } from './server/server-status-identity'
import type { AgentStatusObservationOrigin } from '../../shared/agent-status-observation'
import {
  sameGrokTerminalOwner,
  type GrokSessionObservation,
  type GrokSessionTerminalOwner
} from '../../shared/grok-session-binding'
import type { EnrichedAgentHookEventPayload } from './server/server-types'
import { observeGrokSessionBinding } from './grok-session-binding'

export type {
  AgentHookAuthorityAttestation,
  AgentHookAuthorityEvidence,
  AgentHookProviderSessionIdentity,
  AgentHookStatusRowMutation,
  AgentHookStatusChangeEntry,
  AgentHookStatusFreshnessObservation,
  EnrichedAgentHookEventPayload
} from './server/server-types'
export type { AgentHookSource }
export {
  CLOSED_AGENT_STATUS_TAB_IDS_MAX,
  CLOSED_AGENT_STATUS_PANE_KEYS_MAX,
  PANE_KEY_ALIASES_MAX,
  RETIRED_PANE_FENCES_MAX
} from './server/server-constants'
export { isValidPaneKey }

/** Public composition seam for the loopback hook listener and relay status adapter. */
export class AgentHookServer extends AgentHookServerAgentPresence {
  private sessionTerminalOwnerResolver:
    | ((paneKey: string) => GrokSessionTerminalOwner | null)
    | null = null

  setSessionTerminalOwnerResolver(
    resolver: (paneKey: string) => GrokSessionTerminalOwner | null
  ): void {
    this.sessionTerminalOwnerResolver = resolver
  }

  getGrokSessionObservations(): GrokSessionObservation[] {
    return Array.from(this.state.lastStatusByPaneKey.values()).flatMap((row) =>
      row.grokSessionObservation &&
      !row.grokSessionObservation.unverifiable &&
      !row.restoredUnconfirmed &&
      !row.isReplay
        ? [structuredClone(row.grokSessionObservation)]
        : []
    )
  }

  protected override applyNormalizedStatus(
    incoming: AgentHookEventPayload & { authorityRestartId?: string },
    onAccepted?: () => void,
    origin: AgentStatusObservationOrigin = 'hook',
    observedAt?: number,
    mutationBefore?: EnrichedAgentHookEventPayload
  ): EnrichedAgentHookEventPayload | undefined {
    const previous = this.state.lastStatusByPaneKey.get(incoming.paneKey)?.grokSessionObservation
    const owner = this.sessionTerminalOwnerResolver?.(incoming.paneKey) ?? null
    const grokSessionObservation =
      origin === 'hook'
        ? observeGrokSessionBinding(incoming, previous, owner, Date.now())
        : previous &&
            owner &&
            sameGrokTerminalOwner(previous.owner, owner) &&
            (incoming.payload.agentType === 'grok' || incoming.payload.agentType === 'unknown') &&
            !incoming.isReplay &&
            !incoming.restoredUnconfirmed
          ? previous
          : undefined
    return super.applyNormalizedStatus(
      { ...incoming, grokSessionObservation },
      onAccepted,
      origin,
      observedAt,
      mutationBefore
    )
  }
}

export const agentHookServer = new AgentHookServer()

// Why: exported for test coverage of the per-agent field extractors.
export const _internals = {
  // Why: bind the test-helper to the singleton's state so tests exercise the live caches.
  normalizeHookPayload: (
    source: AgentHookSource,
    body: unknown,
    expectedEnv: string
  ): AgentHookEventPayload | null =>
    normalizeHookPayload(agentHookServer._getStateForTests(), source, body, expectedEnv),
  parseFormEncodedBody,
  resetCachesForTests: (): void => {
    clearAllListenerCaches(agentHookServer._getStateForTests())
    agentHookServer._resetCanonicalStatusForTests()
    agentHookServer._resetRowOwnershipForTests()
    agentHookServer._resetPromptSentDedupeForTests()
    agentHookServer._resetConnectionTimestampWatermarksForTests()
  }
}

export type { HookListenerState } from '../../shared/agent-hook-listener/listener-state'
