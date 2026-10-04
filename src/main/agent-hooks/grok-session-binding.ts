import type { AgentHookEventPayload } from '../../shared/agent-hook-listener/listener-event'
import { isGrokEvent } from '../../shared/agent-hook-listener/provider-event-names'
import {
  sameGrokTerminalOwner,
  type GrokSessionObservation,
  type GrokSessionTerminalOwner
} from '../../shared/grok-session-binding'

const LIVE_EVENT_MAX_AGE_MS = 15_000

function isFreshLiveEvent(eventAt: number, now: number): boolean {
  return now - eventAt <= LIVE_EVENT_MAX_AGE_MS
}

export function observeGrokSessionBinding(
  incoming: AgentHookEventPayload,
  previous: GrokSessionObservation | undefined,
  owner: GrokSessionTerminalOwner | null,
  now: number
): GrokSessionObservation | undefined {
  const eventAt = incoming.grokEventAt
  const sessionId = incoming.providerSession?.id
  const prior =
    previous && owner && sameGrokTerminalOwner(previous.owner, owner) ? previous : undefined
  if (
    incoming.source !== 'grok' ||
    incoming.isReplay ||
    incoming.restoredUnconfirmed ||
    !owner ||
    incoming.connectionId !== null ||
    incoming.launchToken !== owner.launchToken ||
    incoming.paneKey !== owner.paneKey ||
    incoming.tabId !== owner.tabId ||
    incoming.worktreeId !== owner.worktreeId ||
    !sessionId ||
    eventAt === undefined ||
    !Number.isFinite(eventAt) ||
    eventAt <= 0 ||
    eventAt > now + 1000
  ) {
    return prior ? { ...prior, unverifiable: true } : undefined
  }
  if (prior && eventAt < prior.eventAt) {
    return prior
  }
  if (isGrokEvent(incoming.hookEventName, 'session_start')) {
    if (!isFreshLiveEvent(eventAt, now)) {
      return prior ? { ...prior, unverifiable: true } : undefined
    }
    if (prior?.retiredSessionIds.includes(sessionId)) {
      return prior
    }
    if (prior && eventAt === prior.eventAt) {
      return { ...prior, unverifiable: true }
    }
    const retiredSessionIds = prior
      ? [...prior.retiredSessionIds, ...(prior.sessionId !== sessionId ? [prior.sessionId] : [])]
      : []
    if (retiredSessionIds.length > 32) {
      return prior ? { ...prior, unverifiable: true } : undefined
    }
    return { owner, sessionId, boundaryAt: eventAt, eventAt, retiredSessionIds }
  }
  if (!prior) {
    if (previous) {
      // Why: a replacement PTY is a different incarnation; waiting hooks must
      // not retarget the previous session onto it.
      return undefined
    }
    if (isGrokEvent(incoming.hookEventName, 'session_end') || incoming.payload.sessionBoundary) {
      return undefined
    }
    // Why: a delayed SessionStart must not permanently orphan a live pane. A
    // later owner-matched AUQ/waiting hook is exact current-session evidence.
    if (!isFreshLiveEvent(eventAt, now)) {
      return undefined
    }
    return { owner, sessionId, boundaryAt: eventAt, eventAt, retiredSessionIds: [] }
  }
  if (sessionId !== prior.sessionId) {
    return prior
  }
  if (eventAt === prior.eventAt || prior.unverifiable) {
    return { ...prior, unverifiable: true }
  }
  if (isGrokEvent(incoming.hookEventName, 'session_end') || incoming.payload.sessionBoundary) {
    return undefined
  }
  return { ...prior, eventAt }
}
