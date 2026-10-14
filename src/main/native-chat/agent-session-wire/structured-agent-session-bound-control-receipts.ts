import { z } from 'zod'
import {
  AgentSessionControlReceiptSchema,
  type AgentSessionControlReceipt,
  type AgentSessionControlTarget
} from '../../../shared/agent-session-bound-control'
import type { AgentSessionOperationOutcome } from '../../../shared/agent-session-operation-ledger'
import { readAgentJournalTurn } from '../../../shared/agent-session-turn-record'
import type {
  AgentSessionCancelResult,
  AgentSessionMutationEnvelope,
  AgentSessionMutationResult,
  AgentSessionSendResult
} from '../../../shared/agent-session-wire'
import type { StructuredAgentSessionMutationContext } from './structured-agent-session-mutation-context'
import type { StructuredAgentSessionCaller } from './structured-agent-session-host-types'
import type { StructuredAgentSessionSendSettlement } from './structured-agent-session-send-settlement'

const StoredReceipt = z.strictObject({
  receipt: AgentSessionControlReceiptSchema,
  cancelled: z.boolean().optional()
})

export function recordedBoundControlReceipt(outcome: AgentSessionOperationOutcome) {
  if (outcome.status !== 'succeeded') {
    return null
  }
  const read = StoredReceipt.safeParse(outcome.boundControl)
  return read.success ? read.data : null
}

/** Command-receipt replay builds a ledger outcome without `boundControl`; the store row still has it. */
export function recordedBoundControlFromStore(
  context: StructuredAgentSessionMutationContext,
  caller: StructuredAgentSessionCaller,
  envelope: AgentSessionMutationEnvelope
) {
  const row = context.deps.store.evaluateMutationOperation({
    callerKey: caller.callerKey,
    envelope,
    hostFingerprint: envelope.payloadFingerprint,
    now: context.now()
  })
  return row?.decision.decision === 'replay'
    ? recordedBoundControlReceipt(row.decision.row.outcome)
    : null
}

export function boundControlReceipt(
  target: AgentSessionControlTarget,
  clientOperationId: string,
  state: AgentSessionControlReceipt['state']
): AgentSessionControlReceipt {
  return { target, clientOperationId, state }
}

async function persistBoundControlOutcome(
  context: StructuredAgentSessionMutationContext,
  caller: StructuredAgentSessionCaller,
  envelope: AgentSessionMutationEnvelope,
  value: { controlReceipt: AgentSessionControlReceipt; cancelled?: boolean }
): Promise<void> {
  await context.deps.store.recordOperationOutcome({
    callerKey: caller.callerKey,
    operationId: envelope.clientOperationId,
    outcome: {
      status: 'succeeded',
      sessionId: envelope.sessionId,
      boundControl: {
        receipt: value.controlReceipt,
        ...('cancelled' in value ? { cancelled: value.cancelled } : {})
      }
    }
  })
}

export async function observeBoundControlReceipt<
  T extends AgentSessionSendResult | AgentSessionCancelResult
>(
  context: StructuredAgentSessionMutationContext,
  waitForSendSettlement: StructuredAgentSessionSendSettlement['wait'],
  caller: StructuredAgentSessionCaller,
  params: {
    envelope: AgentSessionMutationEnvelope
    expectedControlTarget: AgentSessionControlTarget
  },
  result: AgentSessionMutationResult<T>,
  stop: boolean
): Promise<AgentSessionMutationResult<T>> {
  if (!result.ok || !('controlReceipt' in result.value) || !result.value.controlReceipt) {
    return result
  }
  const receipt = result.value.controlReceipt
  if (receipt.state !== 'accepted' && receipt.state !== 'stopAccepted') {
    if (stop) {
      await persistBoundControlOutcome(context, caller, params.envelope, {
        controlReceipt: receipt,
        ...('cancelled' in result.value ? { cancelled: result.value.cancelled } : {})
      })
    }
    return result
  }
  const { envelope, expectedControlTarget: target } = params
  let state: AgentSessionControlReceipt['state'] = receipt.state
  let submission
  if (stop) {
    const deadline = Date.now() + 5000
    do {
      const session = context.sessions.get(envelope.sessionId)
      const ended = session?.lastEndedChild
      const matchingExit =
        ended?.generation === target.acquisitionGeneration &&
        ended.fence === target.runtimeFence &&
        ended.rootGone
      let matchingEnd = false
      session?.journal.visitItems((_itemId, _sequence, body) => {
        const turn = readAgentJournalTurn(body)
        if (
          turn?.turnId === target.turnId &&
          turn.state !== 'running' &&
          turn.state !== 'unverifiable'
        ) {
          matchingEnd = true
        }
      })
      if (matchingExit || matchingEnd) {
        state = 'stopped'
        break
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 20))
    } while (Date.now() < deadline)
  } else {
    const settled = await waitForSendSettlement(envelope.sessionId, envelope.clientOperationId, {
      until: 'answered',
      budgetMs: 5000
    })
    submission = settled && 'submission' in settled.value ? settled.value.submission : undefined
    if (submission?.dispatchState === 'accepted') {
      state = 'delivered'
    }
    if (submission?.dispatchState === 'unknown' || submission?.dispatchState === 'rejected') {
      state = 'unconfirmed'
    }
  }
  // Acceptance is durable; a bounded observation never schedules another effect.
  if (state === 'stopAccepted') {
    state = 'unconfirmed'
  }
  const controlReceipt = { ...receipt, state }
  const row = context.deps.store.evaluateMutationOperation({
    callerKey: caller.callerKey,
    envelope,
    hostFingerprint: envelope.payloadFingerprint,
    now: context.now(),
    ...(stop ? {} : { operationIdScope: 'global' as const })
  })
  if (row?.decision.decision === 'replay') {
    const prior = recordedBoundControlReceipt(row.decision.row.outcome)?.receipt
    if (prior && prior.state !== 'accepted' && prior.state !== 'stopAccepted') {
      return { ...result, value: { ...result.value, controlReceipt: prior } }
    }
  }
  await persistBoundControlOutcome(context, caller, envelope, {
    ...result.value,
    controlReceipt
  })
  return {
    ...result,
    value: { ...result.value, ...(submission ? { submission } : {}), controlReceipt }
  }
}
