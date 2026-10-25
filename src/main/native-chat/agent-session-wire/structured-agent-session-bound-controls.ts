import {
  AgentSessionRefusalError,
  isAgentSessionRefusalError
} from '../../../shared/agent-session-wire-refusals'
import type {
  AgentSessionControlReceipt,
  AgentSessionControlTarget
} from '../../../shared/agent-session-bound-control'
import {
  agentSessionSendBodyFingerprint,
  agentSessionMessagePayload
} from '../../../shared/structured-agent-session-send-mutation'
import { USER_MESSAGE_SOURCE } from '../../../shared/agent-session/agent-session-message-source'
import {
  refuse,
  type AgentSessionCancelResult,
  type AgentSessionMutationEnvelope,
  type AgentSessionMutationResult,
  type AgentSessionSendResult
} from '../../../shared/agent-session-wire'
import type { AgentJournalMessageItem } from '../../../shared/agent-session-journal-types'
import {
  mutateStructuredAgentSession,
  type StructuredAgentSessionMutationContext
} from './structured-agent-session-mutation-context'
import { StructuredAgentSessionControlTargets } from './structured-agent-session-control-target'
import type { StructuredAgentSessionCaller } from './structured-agent-session-host-types'
import { openForWrite } from './structured-agent-session-send-preparation'
import { performSend } from './structured-agent-session-turns'
import { beginSubmissionHandover } from './structured-agent-session-handover'
import { mutateWithChatStop } from './structured-agent-session-chat-stop'
import { STOP_COMMAND_RECEIPT } from './structured-agent-session-stop-acceptance'
import type { StructuredAgentSessionSendSettlement } from './structured-agent-session-send-settlement'
import {
  recordedBoundControlReceipt,
  recordedBoundControlFromStore,
  observeBoundControlReceipt,
  boundControlReceipt
} from './structured-agent-session-bound-control-receipts'

type BoundParams = {
  envelope: AgentSessionMutationEnvelope
  expectedControlTarget: AgentSessionControlTarget
}

export class StructuredAgentSessionBoundControls {
  readonly targets: StructuredAgentSessionControlTargets
  constructor(
    private readonly context: () => StructuredAgentSessionMutationContext,
    private readonly waitForSendSettlement: StructuredAgentSessionSendSettlement['wait']
  ) {
    this.targets = new StructuredAgentSessionControlTargets(context)
  }

  private validate(params: BoundParams, followUp: boolean) {
    return params.envelope.sessionId !== params.expectedControlTarget.sessionId ||
      params.envelope.expectedRuntimeFence !== params.expectedControlTarget.runtimeFence
      ? refuse(
          'agent_session_operation_invalid',
          { reason: 'requestMalformed' },
          'Envelope and control target must name the same session and fence.'
        )
      : this.targets.validate(params.expectedControlTarget, followUp)
  }

  send = async (
    caller: StructuredAgentSessionCaller,
    params: BoundParams & {
      body: AgentJournalMessageItem
      delivery?: 'queue-if-active'
      retryUnknown?: true
    }
  ): Promise<AgentSessionMutationResult<AgentSessionSendResult>> => {
    const context = this.context()
    const { envelope, expectedControlTarget: target, body } = params
    const receipt = (state: AgentSessionControlReceipt['state']) =>
      boundControlReceipt(target, envelope.clientOperationId, state)
    const accepted = receipt('accepted')
    const outcome = await mutateStructuredAgentSession<AgentSessionSendResult>(
      context,
      caller,
      envelope,
      {
        method: 'agentSession.send',
        operationIdScope: 'global',
        fields: { body: agentSessionMessagePayload(body), expectedControlTarget: target },
        settlesWithWrite: true,
        successReceipt: () =>
          context.deps.store.operationOutcomeReceipt({
            callerKey: caller.callerKey,
            operationId: envelope.clientOperationId,
            outcome: {
              status: 'succeeded',
              sessionId: envelope.sessionId,
              boundControl: { receipt: accepted }
            }
          }),
        run: async (ctx) => {
          if (params.delivery || params.retryUnknown || body.command || body.role !== 'user') {
            return {
              ok: false,
              refusal: refuse(
                'agent_session_operation_invalid',
                { reason: 'requestMalformed' },
                'A strict follow-up requires a direct user message.'
              )
            }
          }
          const refusal = this.validate(params, true)
          if (refusal) {
            return { ok: false, refusal }
          }
          const beforeAcceptance = ctx.journal.cursor()
          const sent = await performSend(ctx, {
            clientMessageId: envelope.clientOperationId,
            payloadFingerprint: agentSessionSendBodyFingerprint(envelope.sessionId, body),
            body,
            origin: 'client',
            source: USER_MESSAGE_SOURCE,
            directHandover: true
          })
          if (!sent.ok || !('submission' in sent.value)) {
            return sent
          }
          const beforePromptWrite = () => {
            const current = this.targets.read(target.sessionId, envelope.clientOperationId)
            const stale = this.targets.validateIdentity(target, current)
            const cursor = ctx.journal.cursor()
            if (
              stale ||
              !current.supported ||
              !current.canFollowUp ||
              cursor.epoch !== beforeAcceptance.epoch ||
              cursor.sequence !== beforeAcceptance.sequence + 2
            ) {
              throw new Error(
                stale?.message ?? 'Control target revision changed during preparation.'
              )
            }
          }
          const pending = await beginSubmissionHandover(
            {
              ...ctx,
              acquireAborts: context.acquireAborts,
              record: () => context.deps.store.getRecord(ctx.sessionId),
              childWork: () => context.readChildWork(ctx.sessionId),
              childWorkOpen: () => context.childWorkOpen(ctx.sessionId),
              beforeDispatch: async () => beforePromptWrite(),
              beforePromptWrite
            },
            sent.value.submission,
            () =>
              !this.targets.validateIdentity(
                target,
                this.targets.read(target.sessionId, envelope.clientOperationId)
              )
          )
          if (pending) {
            try {
              const resolve = await pending.dispatch()
              await resolve()
            } finally {
              pending.release?.()
            }
          }
          return { ok: true, value: { ...sent.value, controlReceipt: accepted } }
        },
        replay: (ctx, prior) => {
          const saved = recordedBoundControlReceipt(prior)
          const controlReceipt = saved?.receipt
          const submission = ctx.journal.submission(envelope.clientOperationId)
          return controlReceipt && submission
            ? { clientMessageId: envelope.clientOperationId, submission, controlReceipt }
            : null
        }
      },
      async (mode) =>
        mode === 'replay' ? openForWrite(context, envelope)() : this.prepare(params, true)
    )
    return observeBoundControlReceipt(
      context,
      this.waitForSendSettlement,
      caller,
      params,
      outcome,
      false
    )
  }

  cancel = async (
    caller: StructuredAgentSessionCaller,
    params: BoundParams & {
      turnId?: string
      scope?: 'background-tasks'
      taskId?: string
      prompt?: { itemId: string; expectedRevision: number }
    }
  ): Promise<AgentSessionMutationResult<AgentSessionCancelResult>> => {
    const context = this.context()
    const { envelope, expectedControlTarget: target } = params
    const receipt = (state: AgentSessionControlReceipt['state']) =>
      boundControlReceipt(target, envelope.clientOperationId, state)
    let cancelTarget = target
    const result = await mutateWithChatStop<AgentSessionCancelResult>(
      context,
      caller,
      params,
      {
        method: 'agentSession.cancel',
        conversationWrite: true,
        commandReceipt: STOP_COMMAND_RECEIPT,
        prepareCancel: () => {
          const current = this.targets.read(target.sessionId)
          const stale = this.targets.validateIdentity(target, current)
          if (stale) {
            throw new AgentSessionRefusalError(stale)
          }
          if (current.supported) {
            cancelTarget = current.target
          }
        },
        beforeCancel: () => {
          const stale = this.targets.validateIdentity(cancelTarget)
          if (stale) {
            throw new AgentSessionRefusalError(stale)
          }
        },
        fields: {
          ...(params.turnId === undefined ? {} : { turnId: params.turnId }),
          expectedControlTarget: target
        },
        run: async () => {
          throw new Error('Bound Stop requires the conversation-stop runner')
        },
        replay: (_ctx, prior) => {
          const saved =
            recordedBoundControlReceipt(prior) ??
            recordedBoundControlFromStore(this.context(), caller, envelope)
          const controlReceipt = saved?.receipt
          return controlReceipt && saved?.cancelled !== undefined
            ? {
                ...(params.turnId ? { turnId: params.turnId } : {}),
                cancelled: saved.cancelled,
                controlReceipt
              }
            : null
        }
      },
      async (_ctx, stop) => {
        if (
          params.scope ||
          params.taskId ||
          params.prompt ||
          (params.turnId ?? null) !== target.turnId
        ) {
          return {
            ok: false,
            refusal: refuse(
              'agent_session_operation_invalid',
              { reason: 'requestMalformed' },
              'A strict Stop names only its exact turn.'
            )
          }
        }
        const refusal = this.validate(params, false)
        if (refusal) {
          return { ok: false, refusal }
        }
        if (target.turnId === null) {
          return { ok: true, value: { cancelled: false, controlReceipt: receipt('notRunning') } }
        }
        const stopped = await stop().catch((error: unknown) => {
          if (isAgentSessionRefusalError(error)) {
            return { outcome: { ok: false as const, refusal: error.refusal }, endsSession: false }
          }
          throw error
        })
        return stopped.outcome.ok
          ? {
              ok: true,
              value: {
                ...stopped.outcome.value,
                controlReceipt: receipt(
                  stopped.outcome.value.cancelled ? 'stopAccepted' : 'unconfirmed'
                )
              }
            }
          : stopped.outcome
      }
    )
    return observeBoundControlReceipt(
      context,
      this.waitForSendSettlement,
      caller,
      params,
      result,
      true
    )
  }

  private async prepare(params: BoundParams, followUp: boolean) {
    const refusal = this.validate(params, followUp)
    return refusal ? { ok: false as const, refusal } : { ok: true as const }
  }
}
