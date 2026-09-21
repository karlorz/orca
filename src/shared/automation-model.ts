import { getAgentSessionOptionCatalog } from './agent-session-option-catalog'
import { hasUnsafeProviderSessionIdChars } from './agent-session-resume'
import type { TuiAgent } from './tui-agent'
import type { AgentLaunchPreferences } from './agent-session-host-authority'

/** Same bound as `MAX_LAUNCH_PREFERENCE_LENGTH`, which already carries model ids
 *  from pickers and workers over the wire. */
export const MAX_AUTOMATION_MODEL_ID_LENGTH = 512
export const AUTOMATION_REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh'] as const
export type AutomationReasoningEffort = (typeof AUTOMATION_REASONING_EFFORTS)[number]

/** `undefined` is "unset": the run launches with the agent's configured default. */
export function normalizeAutomationModel(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed.length > 0 &&
    trimmed.length <= MAX_AUTOMATION_MODEL_ID_LENGTH &&
    !hasUnsafeProviderSessionIdChars(trimmed)
    ? trimmed
    : undefined
}

export function normalizeAutomationReasoningEffort(
  value: unknown
): AutomationReasoningEffort | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return (AUTOMATION_REASONING_EFFORTS as readonly string[]).includes(trimmed)
    ? (trimmed as AutomationReasoningEffort)
    : undefined
}

/** Returns the verified model launch preference, or `undefined` for the no-op
 *  path. The session-option catalog is the source of truth for provider flags:
 *  Grok is `-m`, while agents without a catalog model flag deliberately keep
 *  their own configured default instead of receiving a guessed flag. */
export function buildAutomationModelLaunchPreferences(
  agent: TuiAgent,
  model: unknown,
  effort?: unknown
): AgentLaunchPreferences | undefined {
  const modelId = normalizeAutomationModel(model)
  if (!modelId || !getAgentSessionOptionCatalog(agent)?.modelApply.launchArgs) {
    return undefined
  }
  const reasoningEffort = normalizeAutomationReasoningEffort(effort)
  return { model: modelId, ...(reasoningEffort ? { effort: reasoningEffort } : {}) }
}
