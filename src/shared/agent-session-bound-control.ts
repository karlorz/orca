import { z } from 'zod'

export const AGENT_SESSION_BOUND_CONTROL_CAPABILITY = 'agent-session.bound-control.v1'

const Id = z.string().min(1).max(512)
export const AgentSessionControlTargetSchema = z.strictObject({
  executionHostId: Id,
  runtimeId: Id,
  sessionId: Id,
  provider: z.literal('grok'),
  nativeSessionId: Id,
  turnId: Id.nullable(),
  runtimeFence: z.number().int().positive(),
  acquisitionGeneration: Id,
  revision: z.number().int().positive(),
  token: Id
})
export type AgentSessionControlTarget = z.infer<typeof AgentSessionControlTargetSchema>

export const AgentSessionControlTargetParams = z.strictObject({
  provider: z.literal('grok'),
  nativeSessionId: Id
})

export type AgentSessionControlTargetResult =
  | {
      supported: true
      capability: typeof AGENT_SESSION_BOUND_CONTROL_CAPABILITY
      target: AgentSessionControlTarget
      canFollowUp: boolean
      canStop: boolean
    }
  | {
      supported: false
      reason: 'unresolvable' | 'ambiguous' | 'unsupported' | 'nativeMismatch' | 'inFlightUnresolved'
    }

export const AgentSessionControlReceiptSchema = z.strictObject({
  target: AgentSessionControlTargetSchema,
  clientOperationId: Id,
  state: z.enum(['accepted', 'delivered', 'unconfirmed', 'stopAccepted', 'stopped', 'notRunning'])
})
export type AgentSessionControlReceipt = z.infer<typeof AgentSessionControlReceiptSchema>
