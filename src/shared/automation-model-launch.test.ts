/**
 * Pins what an automation's `model` does to the launch command a run types into
 * the agent's PTY. The `-m` in the grok assertions is the whole point of the
 * field, so it is asserted on the rendered command rather than on the option map.
 */

import { describe, expect, it } from 'vitest'
import {
  buildAutomationModelLaunchPreferences,
  normalizeAutomationExtraArgs
} from './automation-model'
import { buildAgentStartupPlan } from './tui-agent-startup'
import type { TuiAgent } from './tui-agent'

function launchCommandFor(
  agent: TuiAgent,
  model: string | undefined,
  effort?: string,
  agentProfile?: string,
  extraArgs?: string
): string | undefined {
  const sessionOptions = buildAutomationModelLaunchPreferences(
    agent,
    model,
    effort,
    agentProfile,
    extraArgs
  )
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
  it('appends extra args for a non-grok provider after its own model flag', () => {
    expect(
      launchCommandFor('claude', 'claude-sonnet', undefined, undefined, '--verbose')
    ).toContain(
      "claude '--model' 'claude-sonnet' '--permission-mode' 'bypassPermissions' '--verbose'"
    )
  })

  it('rejects protected model flags in extra args', () => {
    expect(normalizeAutomationExtraArgs('--model sneak')).toBeUndefined()
    expect(normalizeAutomationExtraArgs('-c model_reasoning_effort=max')).toBeUndefined()
    expect(normalizeAutomationExtraArgs('--config model_reasoning_effort=max')).toBeUndefined()
    expect(normalizeAutomationExtraArgs('--verbose')).toBe('--verbose')
  })
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

  it('emits the minimal Grok profile before model and effort', () => {
    expect(launchCommandFor('grok', 'deepseek-v4-flash', 'xhigh', 'minimal')).toBe(
      "grok '--agent' 'minimal' '-m' 'deepseek-v4-flash' '--reasoning-effort' 'xhigh' '--permission-mode' 'bypassPermissions' -- 'Triage the alert queue'"
    )
  })

  it('emits Claude model and effort flags', () => {
    expect(launchCommandFor('claude', 'opus', 'high')).toContain(
      "claude '--model' 'opus' '--effort' 'high'"
    )
  })

  it('emits Codex model and max effort flags', () => {
    expect(launchCommandFor('codex', 'gpt-5.6-luna', 'max')).toContain(
      "codex '-m' 'gpt-5.6-luna' '-c' 'model_reasoning_effort=max'"
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
