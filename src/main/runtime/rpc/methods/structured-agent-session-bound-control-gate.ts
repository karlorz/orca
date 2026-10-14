import { AGENT_SESSION_BOUND_CONTROL_CAPABILITY } from '../../../../shared/agent-session-bound-control'
import { STRUCTURED_AGENT_SESSION_REGISTERED_AGENTS_RUNTIME_CAPABILITY } from '../../../../shared/protocol-version'
import { agentSessionRefusalError } from '../../../../shared/agent-session-wire-refusals'
import type { RpcContext } from '../core'
import { requireStructuredCapability } from './structured-agent-session-gate'

export function requireBoundControlCapability(ctx: RpcContext): void {
  requireStructuredCapability(ctx)
  if (
    ctx.clientKind !== undefined &&
    (!ctx.clientCapabilities?.includes(AGENT_SESSION_BOUND_CONTROL_CAPABILITY) ||
      !ctx.clientCapabilities.includes(
        STRUCTURED_AGENT_SESSION_REGISTERED_AGENTS_RUNTIME_CAPABILITY
      ))
  ) {
    throw agentSessionRefusalError('structured_agent_session_unsupported', {
      reason: 'clientCapabilityMissing'
    })
  }
}
