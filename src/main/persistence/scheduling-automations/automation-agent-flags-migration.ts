import type { Automation } from '../../../shared/automations-types'

type AutomationWithLegacyExtraArgs = Automation & {
  extraArgs?: unknown
}

function hasLegacyExtraArgs(automation: Automation): automation is AutomationWithLegacyExtraArgs {
  return Object.hasOwn(automation, 'extraArgs')
}

/**
 * Fork migration: the per-automation free-form provider flags were saved as `extraArgs` before
 * upstream shipped its own allowlisted `extraAgentArgs`. The fork field is now `agentFlags`.
 * Moves a legacy `extraArgs` value onto `agentFlags` (never overwriting a saved `agentFlags`),
 * then drops `extraArgs`. Idempotent, and never reads or writes `extraAgentArgs`.
 */
export function migrateLegacyAutomationAgentFlags(automations: readonly Automation[] | undefined): {
  automations: Automation[]
  changed: boolean
} {
  let changed = false
  const migrated = (automations ?? []).map((automation) => {
    if (!hasLegacyExtraArgs(automation)) {
      return automation
    }
    changed = true
    const { extraArgs: legacy, ...rest } = automation
    const next: Automation = { ...rest }
    const hasAgentFlags = typeof next.agentFlags === 'string' && next.agentFlags.trim() !== ''
    if (!hasAgentFlags && typeof legacy === 'string' && legacy.trim() !== '') {
      next.agentFlags = legacy.trim()
    }
    return next
  })
  return { automations: changed ? migrated : [...(automations ?? [])], changed }
}
