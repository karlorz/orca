/**
 * Pins what an automation's `model` does to the launch command a run types into
 * the agent's PTY. The `-m` in the grok assertions is the whole point of the
 * field, so it is asserted on the rendered command rather than on the option map.
 */

import { describe, expect, it } from 'vitest'
import { buildAutomationModelLaunchPreferences } from './automation-model'
import { buildAgentStartupPlan } from './tui-agent-startup'
import type { TuiAgent } from './tui-agent'

function launchCommandFor(
  agent: TuiAgent,
  model: string | undefined,
  effort?: string
): string | undefined {
  const sessionOptions = buildAutomationModelLaunchPreferences(agent, model, effort)
  return buildAgentStartupPlan({
    agent,
    prompt: 'Triage the alert queue',
    cmdOverrides: {},
    platform: 'linux',
    agentArgs: '--permission-mode bypassPermissions',
    ...(sessionOptions ? { sessionOptions } : {})
  })?.launchCommand
}

describe('automation model launch command', () => {
  it('emits -m <model> for a grok run with a model', () => {
    expect(launchCommandFor('grok', 'deepseek-v4-flash')).toBe(
      "grok '-m' 'deepseek-v4-flash' '--permission-mode' 'bypassPermissions' -- 'Triage the alert queue'"
    )
  })

  it('emits reasoning effort before the prompt terminator', () => {
    expect(launchCommandFor('grok', 'deepseek-v4-flash', 'xhigh')).toBe(
      "grok '-m' 'deepseek-v4-flash' '--reasoning-effort' 'xhigh' '--permission-mode' 'bypassPermissions' -- 'Triage the alert queue'"
    )
  })

  it('emits no model flag for a grok run without one', () => {
    expect(launchCommandFor('grok', undefined)).toBe(
      "grok '--permission-mode' 'bypassPermissions' -- 'Triage the alert queue'"
    )
  })

  it('keeps the model in option position, ahead of the prompt terminator', () => {
    // The id rides before grok's `--`, so the prompt stays the only positional
    // argument even when the stored id reads like CLI syntax.
    expect(launchCommandFor('grok', 'help')).toBe(
      "grok '-m' 'help' '--permission-mode' 'bypassPermissions' -- 'Triage the alert queue'"
    )
  })
})
