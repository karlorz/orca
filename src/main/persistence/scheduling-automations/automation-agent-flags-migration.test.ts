import { describe, expect, it } from 'vitest'
import type { Automation } from '../../../shared/automations-types'
import { migrateLegacyAutomationAgentFlags } from './automation-agent-flags-migration'

function automation(fields: Record<string, unknown>): Automation {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the migration reads only these launch fields.
  return { id: 'auto-1', name: 'Nightly', agentId: 'claude', ...fields } as unknown as Automation
}

describe('migrateLegacyAutomationAgentFlags', () => {
  it('moves legacy extraArgs onto agentFlags and drops the old field', () => {
    const result = migrateLegacyAutomationAgentFlags([automation({ extraArgs: ' --verbose ' })])
    expect(result.changed).toBe(true)
    expect(result.automations[0]).toEqual(automation({ agentFlags: '--verbose' }))
    expect(Object.hasOwn(result.automations[0]!, 'extraArgs')).toBe(false)
  })

  it('is idempotent: a second pass changes nothing', () => {
    const first = migrateLegacyAutomationAgentFlags([automation({ extraArgs: '--verbose' })])
    const second = migrateLegacyAutomationAgentFlags(first.automations)
    expect(second.changed).toBe(false)
    expect(second.automations).toEqual(first.automations)
  })

  it('never touches upstream extraAgentArgs', () => {
    const result = migrateLegacyAutomationAgentFlags([
      automation({ extraArgs: '--verbose', extraAgentArgs: '--model opus' }),
      automation({ id: 'auto-2', extraAgentArgs: '--effort high' })
    ])
    expect(result.automations[0]).toEqual(
      automation({ agentFlags: '--verbose', extraAgentArgs: '--model opus' })
    )
    expect(result.automations[1]).toEqual(
      automation({ id: 'auto-2', extraAgentArgs: '--effort high' })
    )
  })

  it('keeps an existing agentFlags value and drops an empty legacy field', () => {
    const result = migrateLegacyAutomationAgentFlags([
      automation({ extraArgs: '--old', agentFlags: '--new' }),
      automation({ id: 'auto-2', extraArgs: null })
    ])
    expect(result.automations[0]).toEqual(automation({ agentFlags: '--new' }))
    expect(result.automations[1]).toEqual(automation({ id: 'auto-2' }))
  })
})
