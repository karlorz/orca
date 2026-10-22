// @vitest-environment happy-dom

import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { AutomationModelField } from './AutomationModelField'
import { buildAutomationEditDraft } from './automation-edit-draft'
import { normalizeAutomationDraftLaunchOptions } from './automation-draft-model'
import { makeAutomation } from './automations-page-fixtures'
import type { AutomationDraft } from './AutomationEditorDialog'

function ModelField({ initialDraft }: { initialDraft: AutomationDraft }): React.JSX.Element {
  const [draft, setDraft] = useState(initialDraft)
  return (
    <>
      <AutomationModelField draft={draft} pickerTriggerClassName="" onDraftChange={setDraft} />
      <output data-testid="draft">{JSON.stringify(draft)}</output>
      <button
        onClick={() =>
          setDraft((current) =>
            normalizeAutomationDraftLaunchOptions({ ...current, agentId: 'claude' })
          )
        }
      >
        Choose Claude
      </button>
      <button
        onClick={() =>
          setDraft((current) =>
            normalizeAutomationDraftLaunchOptions({ ...current, agentId: 'grok' })
          )
        }
      >
        Choose Grok
      </button>
    </>
  )
}

const grokDraft = (): AutomationDraft =>
  buildAutomationEditDraft(
    makeAutomation({
      agentId: 'grok',
      model: 'deepseek-v4-flash',
      agentProfile: 'minimal'
    })
  )

afterEach(cleanup)

describe('AutomationModelField', () => {
  it('offers only Agent default, high and max for Grok and preserves an explicit max', async () => {
    const user = userEvent.setup()
    render(<ModelField initialDraft={grokDraft()} />)
    await user.click(screen.getByRole('combobox', { name: 'Reasoning effort' }))
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Agent default',
      'High',
      'Max'
    ])
    await user.click(screen.getByRole('option', { name: 'Max' }))
    expect(screen.getByTestId('draft').textContent).toContain('"reasoningEffort":"max"')
    await user.click(screen.getByRole('combobox', { name: 'Reasoning effort' }))
    await user.click(screen.getByRole('option', { name: 'Agent default' }))
    expect(screen.getByTestId('draft').textContent).toContain('"reasoningEffort":""')
  })

  it('hides profiles and clears the value when the selected agent changes', async () => {
    const user = userEvent.setup()
    render(<ModelField initialDraft={grokDraft()} />)
    expect(screen.getByRole('combobox', { name: 'Agent profile' })).toBeDefined()
    await user.click(screen.getByRole('button', { name: 'Choose Claude' }))
    expect(screen.queryByRole('combobox', { name: 'Agent profile' })).toBeNull()
    expect(screen.getByTestId('draft').textContent).not.toContain('agentProfile')
    await user.click(screen.getByRole('button', { name: 'Choose Grok' }))
    expect(screen.getByRole('combobox', { name: 'Agent profile' }).textContent).toContain(
      'Agent default'
    )
  })

  it('uses the selected model menu and clears effort when the model no longer supports it', async () => {
    const user = userEvent.setup()
    const draft = buildAutomationEditDraft(
      makeAutomation({ agentId: 'claude', model: 'opus', reasoningEffort: 'max' })
    )
    render(<ModelField initialDraft={draft} />)
    await user.click(screen.getByRole('combobox', { name: 'Reasoning effort' }))
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Agent default',
      'Low',
      'Medium',
      'High',
      'Extra high',
      'Max'
    ])
    await user.keyboard('{Escape}')
    fireEvent.change(screen.getByRole('textbox', { name: 'Model' }), { target: { value: 'haiku' } })
    expect(screen.getByTestId('draft').textContent).toContain('"reasoningEffort":""')
    // No valid tiers for this agent/model pair: the control disappears entirely.
    expect(screen.queryByRole('combobox', { name: 'Reasoning effort' })).toBeNull()
  })

  it('hides the effort control for a model that ignores the effort flag', () => {
    render(<ModelField initialDraft={grokDraft()} />)
    expect(screen.getByRole('combobox', { name: 'Reasoning effort' })).toBeDefined()
    fireEvent.change(screen.getByRole('textbox', { name: 'Model' }), {
      target: { value: 'flash-non-reasoning' }
    })
    expect(screen.queryByRole('combobox', { name: 'Reasoning effort' })).toBeNull()
  })

  it('cleans legacy profile and unsupported effort values when opening an edit draft', () => {
    const draft = buildAutomationEditDraft(
      makeAutomation({
        agentId: 'claude',
        model: 'haiku',
        reasoningEffort: 'medium',
        agentProfile: 'minimal'
      })
    )
    expect(draft.agentProfile).toBeUndefined()
    expect(draft.reasoningEffort).toBe('')
    expect(
      buildAutomationEditDraft(
        makeAutomation({ agentId: 'grok', model: 'grok-4.7', reasoningEffort: 'max' })
      ).reasoningEffort
    ).toBe('')
    expect(
      buildAutomationEditDraft(
        makeAutomation({ agentId: 'grok', model: 'grok-4.7', reasoningEffort: 'xhigh' })
      ).reasoningEffort
    ).toBe('xhigh')
  })
})
