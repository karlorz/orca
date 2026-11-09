import { defineMethod } from '../../../core'
import { OrchestrationError } from '../../../../orchestration/orchestration-error'
import { ORCHESTRATION_LEGACY_RUN_ID } from '../../../../../../shared/orchestration-rpc-contract'
import { resolveRunScope } from '../runs/run-scope'
import {
  readMutationReplayNudge,
  stripMutationReplayNudge
} from '../../../orchestration-mutation-receipt'
import { exposeMessage } from './mailbox-message-receipt'
import { resolveOrchestrationParty } from '../../../../orchestration/orchestration-party'
import { recordReceiptBeforeNudge, replayMutationNudge } from './mutation-replay-nudge'
import { resolveReplyRecipient } from './recipient-routing'
import { helperQuestionAnswerer } from './helper-question-answerer'
import { replyToRemoteRunHome } from './reply-remote'
import { ReplyParams, InboxParams } from '../schemas'
import { ORCHESTRATION_TASK_METHODS } from './task-methods'

export const ORCHESTRATION_MESSAGE_METHODS = [
  defineMethod({
    name: 'orchestration.reply',
    permission: 'workspace',
    params: ReplyParams,
    handler: async (
      params,
      {
        orchestrationCompatibilityEvidence,
        orchestrationCaller,
        runtime,
        legacyCoordinatorRunId,
        recordMutationReceipt,
        replayedMutationReceipt,
        signal
      }
    ) => {
      const replayNudge = readMutationReplayNudge(replayedMutationReceipt)
      if (replayNudge) {
        replayMutationNudge(runtime, replayNudge)
        return stripMutationReplayNudge(replayedMutationReceipt)
      }
      const db = runtime.getOrchestrationDb()
      const original = db.getMessageById(params.id)
      if (!original) {
        throw new Error(`Message not found: ${params.id}`)
      }
      if (
        legacyCoordinatorRunId &&
        (original.run_id !== legacyCoordinatorRunId ||
          (params.run !== undefined && params.run !== legacyCoordinatorRunId))
      ) {
        throw new OrchestrationError(
          'request_mismatch',
          `Message ${params.id} does not belong to this adopted Run.`,
          { effectsApplied: false }
        )
      }
      if (
        original.run_id === ORCHESTRATION_LEGACY_RUN_ID ||
        original.delivery_contract === 'legacy_direct' ||
        original.delivery_contract === 'audit_only'
      ) {
        throw new OrchestrationError(
          'legacy_read_only',
          'Legacy orchestration messages are inspect-only; no reply was applied.',
          { effectsApplied: false }
        )
      }

      const question = db.getQuestion(params.id)
      const creatorAnswerer =
        question && (params.run === undefined || params.run === question.run_id)
          ? helperQuestionAnswerer(runtime, {
              question: original,
              from: params.from,
              session: orchestrationCaller,
              evidence: orchestrationCompatibilityEvidence
            })
          : undefined
      if (question && creatorAnswerer) {
        const answered = db.answerQuestion({
          messageId: question.message_id,
          runId: question.run_id,
          answeredBy: creatorAnswerer,
          body: params.body
        })
        return recordReceiptBeforeNudge(
          recordMutationReceipt,
          { ...answered, message: exposeMessage(answered.message) },
          () => runtime.notifyMessageArrived(`dispatch:${question.dispatch_id}`, 'status')
        )
      }
      if (question) {
        const run = resolveRunScope(runtime, {
          runId: params.run ?? question.run_id,
          callerTerminalHandle: params.from,
          requireCurrentConsumer: true,
          legacyCoordinatorRunId,
          callerEvidence: orchestrationCompatibilityEvidence,
          callerSession: orchestrationCaller
        })
        const answered = db.answerQuestion({
          messageId: question.message_id,
          runId: run.id,
          consumerGeneration: run.consumer_generation,
          body: params.body
        })
        const federated = db.getFederatedDispatch(question.dispatch_id)
        const receipt = {
          message: exposeMessage(answered.message),
          question: answered.question,
          duplicate: answered.duplicate
        }
        if (federated) {
          db.enqueueFederationRelay({
            dispatchId: question.dispatch_id,
            direction: 'to_worker',
            kind: 'reply',
            payload: JSON.stringify({
              questionId: question.message_id,
              answerMessageId: answered.message.id,
              body: params.body
            })
          })
          return recordReceiptBeforeNudge(
            recordMutationReceipt,
            receipt,
            () => runtime.ensureOrchestrationFederationRelay(run.id),
            { kind: 'federation', runId: run.id }
          )
        }
        return recordReceiptBeforeNudge(recordMutationReceipt, receipt, () =>
          runtime.notifyMessageArrived(`dispatch:${question.dispatch_id}`, 'status')
        )
      }

      if (db.getRun(original.run_id)?.home_database === 'remote') {
        return await replyToRemoteRunHome({ runtime, db, original, params, signal })
      }
      const recipient = resolveReplyRecipient({
        runtime,
        db,
        originalFrom: original.from_handle,
        originalRunId: original.run_id
      })
      db.markAsRead([original.id])
      const reply = db.insertMessage({
        from: params.from ?? original.to_handle,
        to: recipient.to,
        subject: `Re: ${original.subject}`,
        body: params.body,
        threadId: original.thread_id ?? original.id,
        runId: recipient.runId
      })

      const receipt = { message: exposeMessage(reply) }
      return recordReceiptBeforeNudge(recordMutationReceipt, receipt, () =>
        runtime.notifyMessageArrived(reply.to_handle, reply.type)
      )
    }
  }),

  defineMethod({
    name: 'orchestration.inbox',
    permission: 'workspace',
    params: InboxParams,
    handler: (params, { runtime }) => {
      const db = runtime.getOrchestrationDb()
      // Return empty for stale/unknown handles because historical mail outlives handle deletion (design doc §3.3).
      const messages = params.terminal
        ? db.getAllMessagesForHandle(
            resolveOrchestrationParty(params.terminal, db).address,
            params.limit
          )
        : db.getInbox(params.limit)
      if (params.run === undefined) {
        return { messages, count: messages.length }
      }
      const run = db.getRun(params.run)
      if (!run) {
        throw new OrchestrationError('run_not_found', `Run ${params.run} was not found.`)
      }
      return { messages, count: messages.length, runId: run.id, fence: db.getRunMailboxFence(run.id) }
    }
  }),
  ...ORCHESTRATION_TASK_METHODS
]
