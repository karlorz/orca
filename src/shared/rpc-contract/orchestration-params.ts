import { z } from 'zod'
import {
  OptionalBoolean,
  OptionalFiniteNumber,
  OptionalString,
  requiredString
} from './rpc-param-primitives'

export type DispatchMutationMessageType =
  | 'worker_done'
  | 'heartbeat'
  | 'escalation'
  | 'decision_gate'

export function isDispatchMutationMessageType(
  type: string | undefined
): type is DispatchMutationMessageType {
  return (
    type === 'worker_done' ||
    type === 'heartbeat' ||
    type === 'escalation' ||
    type === 'decision_gate'
  )
}

export function getLifecycleGroupRecipientError(type: DispatchMutationMessageType): string {
  return `${type} messages belong to one exact Dispatch and cannot target a group address.`
}

export const CheckParams = z
  .object({
    terminal: OptionalString,
    terminalPaneKey: OptionalString,
    unread: OptionalBoolean,
    peek: OptionalBoolean,
    // all skips mark-read; legacy clients encoded it as unread:false.
    all: OptionalBoolean,
    types: OptionalString,
    format: OptionalBoolean,
    // Why: one-release RPC compatibility only; the public CLI uses --format because no terminal input is injected.
    inject: OptionalBoolean,
    ack: OptionalString,
    compatibilityAck: OptionalString,
    compatibilityQuestionAck: OptionalString,
    compatibilityCliCommand: z.enum(['orca', 'orca-ide', 'orca-dev']).optional(),
    run: OptionalString,
    wait: OptionalBoolean,
    timeoutMs: OptionalFiniteNumber,
    selective: OptionalBoolean,
    messageId: OptionalString,
    expectFence: OptionalFiniteNumber
  })
  .superRefine((params, ctx) => {
    // Why: CLI encodes --peek as {peek:true, unread:false} for pre-peek runtimes, so that pair is one mode, not a conflict.
    const modes = [
      params.unread === true,
      params.peek === true,
      params.all === true || (params.unread === false && params.peek !== true),
      params.selective === true
    ].filter(Boolean)
    if (modes.length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Choose at most one message read mode: --unread, --peek, --all, or --selective.'
      })
    }
    if (params.selective === true && !params.messageId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '--selective requires --message-id.',
        path: ['messageId']
      })
    }
    if (params.selective !== true && params.messageId !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '--message-id requires --selective.',
        path: ['selective']
      })
    }
    if (params.selective === true && (params.ack !== undefined || params.wait === true)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '--selective cannot be combined with --ack or --wait.'
      })
    }
    if (
      params.expectFence !== undefined &&
      (!Number.isInteger(params.expectFence) || params.expectFence < 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '--expect-fence must be a non-negative integer.',
        path: ['expectFence']
      })
    }
  })

export const ReplyParams = z.object({
  id: requiredString('Missing --id'),
  body: requiredString('Missing --body'),
  from: OptionalString,
  run: OptionalString
})

export const InboxParams = z.object({
  limit: OptionalFiniteNumber,
  // Filter inbox by handle to agree with check --all.
  terminal: OptionalString,
  // Optional Run scope: the response then carries that Run's mailbox fence.
  run: OptionalString
})

export const TaskCreateParams = z
  .object({
    spec: requiredString('Missing --spec'),
    taskTitle: OptionalString,
    displayName: OptionalString,
    deps: OptionalString,
    parent: OptionalString,
    callerTerminalHandle: OptionalString,
    run: OptionalString,
    messageId: OptionalString,
    cardDigest: OptionalString,
    intentJob: OptionalString,
    intentRun: OptionalString
  })
  .superRefine((params, ctx) => {
    const fields = [params.messageId, params.cardDigest, params.intentJob, params.intentRun]
    const present = fields.filter((value) => value !== undefined)
    if (present.length === 0) {
      return
    }
    // A unique binding is all-or-nothing; a partial intent cannot be reconciled.
    if (present.length !== fields.length || fields.some((value) => value === '')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          '--message-id, --card, --intent-job and --intent-run must be supplied together.',
        path: ['messageId']
      })
      return
    }
    if (!/^[0-9a-f]{64}$/.test(params.cardDigest ?? '')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '--card must be exactly 64 lowercase hex characters (sha256).',
        path: ['cardDigest']
      })
    }
  })

export const TaskListParams = z
  .object({
    status: z.enum(['pending', 'ready', 'dispatched', 'completed', 'failed', 'blocked']).optional(),
    ready: OptionalBoolean,
    // Why: server-side truncation keeps --brief cheap over SSH/relay instead of shipping full specs the CLI throws away.
    brief: OptionalBoolean,
    run: OptionalString,
    callerTerminalHandle: OptionalString,
    // Scoped readback: count 0 here is scoped absence, never global absence.
    messageId: OptionalString,
    cardDigest: OptionalString,
    // Global probe: the only authoritative M lookup across Runs.
    globalBinding: OptionalBoolean
  })
  .superRefine((params, ctx) => {
    if (params.globalBinding !== true) {
      return
    }
    if (!params.messageId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '--global-binding requires --message-id.',
        path: ['messageId']
      })
    }
    if (
      params.cardDigest !== undefined ||
      params.status !== undefined ||
      params.ready === true ||
      params.brief === true
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '--global-binding cannot be combined with card, status, ready, or brief filters.'
      })
    }
  })

export const TaskShowParams = z.object({
  id: requiredString('Missing --id'),
  run: OptionalString,
  callerTerminalHandle: OptionalString
})

export const DispatchParams = z.object({
  task: requiredString('Missing --task'),
  // Why: --to is optional so --dry-run can preview without a target; the handler enforces presence before any side-effecting work.
  to: OptionalString,
  from: OptionalString,
  inject: OptionalBoolean,
  dryRun: OptionalBoolean,
  returnPreamble: OptionalBoolean,
  devMode: OptionalBoolean,
  run: OptionalString
})

/** An Orca agent session id; the answer is its conversation's Orca session ID. */
export const SessionAddressParams = z.object({
  sessionId: requiredString('Missing sessionId')
})

/** Resolve earlier-run mailbox handles through the message’s recorded sender pane. */
export const PartyLocationParams = z.object({
  address: requiredString('Missing address'),
  messageIds: z.array(z.string().min(1).max(256)).max(50).optional()
})

export const DispatchShowParams = z.object({
  task: OptionalString,
  preamble: OptionalBoolean,
  from: OptionalString,
  devMode: OptionalBoolean
})

export const AskParams = z
  .object({
    to: OptionalString,
    question: OptionalString,
    resume: OptionalString,
    options: OptionalString,
    timeoutMs: OptionalFiniteNumber,
    from: OptionalString,
    run: OptionalString,
    compatibilityCliCommand: z.enum(['orca', 'orca-ide', 'orca-dev']).optional(),
    compatibilityWindowsCommand: z.enum(['orca', 'orca-ide']).optional()
  })
  .superRefine((params, ctx) => {
    if ((params.question ? 1 : 0) + (params.resume ? 1 : 0) !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Choose exactly one of --question or --resume.'
      })
    }
  })

export const ResetParams = z
  .object({
    all: OptionalBoolean,
    tasks: OptionalBoolean,
    messages: OptionalBoolean
  })
  .superRefine((params, ctx) => {
    const selectedScopeCount = [params.all, params.tasks, params.messages].filter(
      (scope) => scope === true
    ).length
    if (selectedScopeCount !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Choose exactly one reset scope: --all, --tasks, or --messages.'
      })
    }
  })
