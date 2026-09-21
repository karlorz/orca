import { getAgentSessionOptionCatalog } from './agent-session-option-catalog'
import { hasUnsafeProviderSessionIdChars } from './agent-session-resume'
import type { TuiAgent } from './tui-agent'

/** Same bound as `MAX_LAUNCH_PREFERENCE_LENGTH`, which already carries model ids
 *  from pickers and workers over the wire. */
export const MAX_AUTOMATION_MODEL_ID_LENGTH = 512

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

/** Returns the verified model launch preference, or `undefined` for the no-op
 *  path. The session-option catalog is the source of truth for provider flags:
 *  Grok is `-m`, while agents without a catalog model flag deliberately keep
 *  their own configured default instead of receiving a guessed flag. */
export function buildAutomationModelLaunchPreferences(
  agent: TuiAgent,
  model: unknown
): { model: string } | undefined {
  const modelId = normalizeAutomationModel(model)
  if (!modelId || !getAgentSessionOptionCatalog(agent)?.modelApply.launchArgs) {
    return undefined
  }
  return { model: modelId }
}
