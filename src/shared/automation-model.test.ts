import { describe, expect, it } from 'vitest'
import {
  buildAutomationModelLaunchPreferences,
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

  it('accepts only the supported reasoning effort ladder', () => {
    expect(normalizeAutomationReasoningEffort(' xhigh ')).toBe('xhigh')
    expect(normalizeAutomationReasoningEffort('max')).toBeUndefined()
    expect(buildAutomationModelLaunchPreferences('grok', 'deepseek-v4-flash', 'xhigh')).toEqual({
      model: 'deepseek-v4-flash',
      effort: 'xhigh'
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
