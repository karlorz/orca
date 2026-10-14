import { agentSessionProviderHandleChainHead } from '../../../shared/agent-session-provider-handle'
import { randomUUID } from 'node:crypto'
import {
  AGENT_SESSION_BOUND_CONTROL_CAPABILITY,
  type AgentSessionControlTarget,
  type AgentSessionControlTargetResult
} from '../../../shared/agent-session-bound-control'
import {
  canonicalAgentSessionDigest,
  refuseUnlessWriterAdmitted
} from '../../../shared/agent-session-mutation-envelope'
import { refuse } from '../../../shared/agent-session-wire'
import type { StructuredAgentSessionMutationContext } from './structured-agent-session-mutation-context'
import { structuredAgentSessionProviderSessionMetadata } from './structured-agent-session-history-result'
import { holdsLiveProviderChild } from './structured-agent-session-provider-child'

export class StructuredAgentSessionControlTargets {
  private readonly runtimeId = randomUUID()
  private revision = 0
  private readonly snapshots = new Map<
    string,
    { stamp: string; target: AgentSessionControlTarget }
  >()
  constructor(private readonly context: () => StructuredAgentSessionMutationContext) {}

  resolve = async (params: {
    provider: 'grok'
    nativeSessionId: string
  }): Promise<AgentSessionControlTargetResult> => {
    const context = this.context()
    const matches = this.matches(params.nativeSessionId)
    if (matches.length !== 1) {
      return { supported: false, reason: matches.length ? 'ambiguous' : 'unresolvable' }
    }
    return context.serialize(matches[0], async () => {
      const currentMatches = this.matches(params.nativeSessionId)
      if (currentMatches.length !== 1 || currentMatches[0] !== matches[0]) {
        return { supported: false, reason: 'ambiguous' }
      }
      return this.read(matches[0])
    })
  }

  private matches(nativeSessionId: string): string[] {
    const { deps } = this.context()
    return deps.store
      .listRecords()
      .filter((record) => {
        return (
          record.provider === 'grok' &&
          structuredAgentSessionProviderSessionMetadata(record)?.id === nativeSessionId
        )
      })
      .map((record) => record.sessionId)
  }

  read(sessionId: string, ownMessageId?: string): AgentSessionControlTargetResult {
    const { sessions, deps } = this.context()
    const session = sessions.get(sessionId)
    const record = deps.store.getRecord(sessionId)
    const child = session?.child
    const binding = deps.adapter.controlBinding?.(sessionId)
    if (
      !record ||
      record.provider !== 'grok' ||
      !session ||
      !child ||
      !binding ||
      child.close ||
      child.phase !== 'ready' ||
      refuseUnlessWriterAdmitted(record.lease) ||
      !holdsLiveProviderChild(
        session,
        record.lease.runtimeFence,
        (generation) => deps.adapter.holdsLiveProviderProcess?.(sessionId, generation) === true
      )
    ) {
      this.snapshots.delete(sessionId)
      return { supported: false, reason: 'unsupported' }
    }
    const head = agentSessionProviderHandleChainHead(record.providerHandleChain)
    const nativeSessionId = structuredAgentSessionProviderSessionMetadata(record)?.id
    if (
      head?.handle.transport !== 'acp' ||
      head.handle.agent !== 'grok' ||
      !nativeSessionId ||
      nativeSessionId !== binding.nativeSessionId ||
      child.generation !== binding.acquisitionGeneration
    ) {
      this.snapshots.delete(sessionId)
      return { supported: false, reason: 'nativeMismatch' }
    }
    const turnId = session.journal.activeTurnId()
    if (
      turnId !== binding.turnId ||
      (turnId === null &&
        (deps.adapter.holdsDispatch?.(sessionId) ||
          session.journal
            .submissions()
            .some((s) => s.clientMessageId !== ownMessageId && s.dispatchState === 'pending')))
    ) {
      this.snapshots.delete(sessionId)
      return { supported: false, reason: 'inFlightUnresolved' }
    }
    const pending: [string, number][] = []
    session.journal.visitItems((itemId, _sequence, body) => {
      if (
        (body.kind === 'question' || body.kind === 'approval') &&
        body.resolution.state === 'pending'
      ) {
        pending.push([itemId, session.journal.item(itemId)?.revision ?? 0])
      }
    })
    const identity = {
      executionHostId: record.location.executionHostId,
      runtimeId: this.runtimeId,
      sessionId,
      provider: 'grok' as const,
      nativeSessionId,
      turnId,
      runtimeFence: record.lease.runtimeFence,
      acquisitionGeneration: binding.acquisitionGeneration
    }
    const stamp = canonicalAgentSessionDigest({
      ...identity,
      cursor: session.journal.cursor(),
      stopRevision: session.journal.stopMarks.revision(),
      prompts: pending,
      promptPending: binding.promptPending
    })
    let snapshot = this.snapshots.get(sessionId)
    if (!snapshot || snapshot.stamp !== stamp) {
      snapshot = { stamp, target: { ...identity, revision: ++this.revision, token: randomUUID() } }
      this.snapshots.set(sessionId, snapshot)
    }
    return {
      supported: true,
      capability: AGENT_SESSION_BOUND_CONTROL_CAPABILITY,
      target: snapshot.target,
      canFollowUp:
        binding.canFollowUp && turnId === null && !binding.promptPending && pending.length === 0,
      canStop: turnId !== null
    }
  }

  validateIdentity(target: AgentSessionControlTarget, current = this.read(target.sessionId)) {
    const { token: _token, revision: _revision, ...identity } = target
    if (current.supported) {
      const { token: _currentToken, revision: _currentRevision, ...now } = current.target
      if (canonicalAgentSessionDigest(now) === canonicalAgentSessionDigest(identity)) {
        return null
      }
    }
    return refuse(
      'agent_session_ownership_unknown',
      { reason: 'leaseMoved' },
      'The provider target changed before cancellation.'
    )
  }

  validate(target: AgentSessionControlTarget, followUp: boolean) {
    const current = this.read(target.sessionId)
    if (
      !current.supported ||
      canonicalAgentSessionDigest(current.target) !== canonicalAgentSessionDigest(target)
    ) {
      return refuse(
        'agent_session_ownership_unknown',
        { reason: 'leaseMoved' },
        'The exact control target is no longer current. Read a new target before a new operation.'
      )
    }
    return followUp && !current.canFollowUp
      ? refuse(
          'agent_session_operation_invalid',
          { reason: 'promptPending' },
          'This session is waiting for a response or conversation command and cannot take a follow-up.'
        )
      : null
  }
}
