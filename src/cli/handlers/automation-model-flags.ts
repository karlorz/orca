import {
  normalizeAutomationReasoningEffort,
  validateAutomationExtraArgs,
  type AutomationReasoningEffort
} from '../../shared/automation-model'
import { getOptionalStringFlag } from '../flags'
import { RuntimeClientError } from '../runtime-client'

export function getReasoningEffortFlag(
  flags: Map<string, string | boolean>
): AutomationReasoningEffort | null | undefined {
  if (!flags.has('reasoning-effort')) {
    return undefined
  }
  const raw = getOptionalStringFlag(flags, 'reasoning-effort') ?? ''
  if (!raw) {
    return null
  }
  const effort = normalizeAutomationReasoningEffort(raw)
  if (!effort) {
    throw new RuntimeClientError(
      'invalid_argument',
      '--reasoning-effort must be one of low, medium, high, xhigh, max, or ultra'
    )
  }
  return effort
}

export function getAgentProfileFlag(
  flags: Map<string, string | boolean>
): 'minimal' | null | undefined {
  if (!flags.has('agent-profile')) {
    return undefined
  }
  const raw = getOptionalStringFlag(flags, 'agent-profile') ?? ''
  if (!raw) {
    return null
  }
  if (raw !== 'minimal') {
    throw new RuntimeClientError('invalid_argument', '--agent-profile must be minimal')
  }
  return 'minimal'
}

export function getExtraArgsFlag(flags: Map<string, string | boolean>): string | null | undefined {
  if (!flags.has('extra-args')) {
    return undefined
  }
  const raw = getOptionalStringFlag(flags, 'extra-args') ?? ''
  if (!raw) {
    return null
  }
  try {
    return validateAutomationExtraArgs(raw) ?? null
  } catch (error) {
    throw new RuntimeClientError(
      'invalid_argument',
      error instanceof Error ? error.message : 'Invalid extra args'
    )
  }
}
