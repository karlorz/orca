import { describe, expect, it } from 'vitest'
import {
  buildAutomationModelLaunchPreferences,
  getAutomationReasoningEffortChoices,
  isAutomationReasoningEffortSupported,
  normalizeAutomationReasoningEffort,
  MAX_AUTOMATION_MODEL_ID_LENGTH,
  normalizeAutomationModel
} from './automation-model'

describe('normalizeAutomationModel', () => {
  it('keeps a trimmed model id', () => {
    expect(normalizeAutomationModel('  deepseek-v4-flash  ')).toBe('deepseek-v4-flash')
  })

  it('treats empty, blank, and non-string values as unset', () => {
    for (const value of ['', '   ', null, undefined, 7, {}, []]) {
      expect(normalizeAutomationModel(value)).toBeUndefined()
    }
  })

  it('rejects ids that cannot survive a launch command', () => {
    // Control characters would land in the PTY stream as keystrokes, and an
    // over-long id is not a model any CLI could resolve.
    expect(normalizeAutomationModel('bad\u001bmodel')).toBeUndefined()
    expect(normalizeAutomationModel('a'.repeat(MAX_AUTOMATION_MODEL_ID_LENGTH + 1))).toBeUndefined()
  })
})

describe('buildAutomationModelLaunchPreferences', () => {
  it('maps grok models onto the catalog default model flag', () => {
    expect(buildAutomationModelLaunchPreferences('grok', ' deepseek-v4-flash ')).toEqual({
      model: 'deepseek-v4-flash'
    })
  })

  it('normalizes the supported reasoning effort ladder', () => {
    expect(normalizeAutomationReasoningEffort(' xhigh ')).toBe('xhigh')
    expect(normalizeAutomationReasoningEffort('bogus')).toBeUndefined()
    expect(normalizeAutomationReasoningEffort('max')).toBe('max')
  })

  it('accepts a grok effort only while it is in the model’s own menu', () => {
    // Why: deepseek-v4-flash only accepts high and max.
    expect(buildAutomationModelLaunchPreferences('grok', 'deepseek-v4-flash', 'max')).toEqual({
      model: 'deepseek-v4-flash',
      effort: 'max'
    })
    expect(buildAutomationModelLaunchPreferences('grok', 'deepseek-v4-flash', 'high')).toEqual({
      model: 'deepseek-v4-flash',
      effort: 'high'
    })
    for (const effort of ['low', 'medium', 'xhigh'] as const) {
      expect(buildAutomationModelLaunchPreferences('grok', 'deepseek-v4-flash', effort)).toEqual({
        model: 'deepseek-v4-flash'
      })
    }
    // grok-4.5 accepts low, medium, high
    expect(buildAutomationModelLaunchPreferences('grok', 'grok-4.5', 'medium')).toEqual({
      model: 'grok-4.5',
      effort: 'medium'
    })
    expect(buildAutomationModelLaunchPreferences('grok', 'grok-4.5', 'max')).toEqual({
      model: 'grok-4.5'
    })
  })

  it('keeps each other agent on its own catalog menu', () => {
    expect(buildAutomationModelLaunchPreferences('codex', 'gpt-5.6-luna', 'max')).toMatchObject({
      model: 'gpt-5.6-luna',
      effort: 'max'
    })
    expect(
      buildAutomationModelLaunchPreferences('claude', 'opus', 'high', 'minimal')
    ).toMatchObject({
      model: 'opus',
      effort: 'high'
    })
  })

  it('never forwards a grok-only profile to another agent', () => {
    expect(buildAutomationModelLaunchPreferences('claude', 'opus', 'high', 'minimal')).toEqual({
      model: 'opus',
      effort: 'high'
    })
  })

  it('launches the agent default when no model is set', () => {
    expect(buildAutomationModelLaunchPreferences('grok', undefined)).toBeUndefined()
    expect(buildAutomationModelLaunchPreferences('grok', '')).toBeUndefined()
  })

  it('leaves agents without a verified model flag on their own default', () => {
    // Why: these agents are outside the session-option catalog, so Orca has no
    // flag it may emit. A guessed `--model` would fail the launch outright.
    for (const agent of ['aider', 'goose', 'amp', 'cline', 'devin'] as const) {
      expect(buildAutomationModelLaunchPreferences(agent, 'some-model')).toBeUndefined()
    }
  })
})

describe('getAutomationReasoningEffortChoices', () => {
  it('offers the picked model’s own menu', () => {
    expect(getAutomationReasoningEffortChoices('grok', 'grok-4.5')).toEqual([
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' }
    ])
    expect(getAutomationReasoningEffortChoices('grok', 'kimi-k3')).toEqual([
      { value: 'high', label: 'High' },
      { value: 'max', label: 'Max' }
    ])
  })

  it('falls back to the unknown-model menu for an unseeded id', () => {
    expect(getAutomationReasoningEffortChoices('grok', 'grok-build')).toEqual([
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
      { value: 'xhigh', label: 'Extra high' },
      { value: 'max', label: 'Max' }
    ])
  })

  it('offers no effort row until a model is picked', () => {
    // The dialog hides the effort control entirely in that state.
    expect(getAutomationReasoningEffortChoices('grok', '')).toEqual([])
    expect(getAutomationReasoningEffortChoices('grok', '   ')).toEqual([])
    expect(getAutomationReasoningEffortChoices('grok', undefined)).toEqual([])
  })

  it('offers nothing for an agent with no catalog model flag', () => {
    expect(getAutomationReasoningEffortChoices('aider', 'some-model')).toEqual([])
  })

  it('matches the validator for every offered choice', () => {
    for (const choice of getAutomationReasoningEffortChoices('grok', 'grok-4.5')) {
      expect(isAutomationReasoningEffortSupported('grok', 'grok-4.5', choice.value)).toBe(true)
    }
    expect(isAutomationReasoningEffortSupported('grok', 'grok-4.5', 'xhigh')).toBe(false)
    expect(isAutomationReasoningEffortSupported('grok', 'grok-4.5', 'max')).toBe(false)
  })
})
