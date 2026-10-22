// @vitest-environment happy-dom

import { act } from 'react'
import { describe, expect, it } from 'vitest'
import type { AutomationDraft } from './AutomationEditorDialog'
import {
  api,
  installAutomationsPageHarness,
  mocks,
  renderPage,
  scopedList,
  settleHostQueries
} from './automations-page-test-harness'
import { makeAutomation, REPO_ID, WORKSPACE_ID } from './automations-page-fixtures'
import { buildAutomationEditDraft } from './automation-edit-draft'

function updateDraft(updates: Partial<AutomationDraft>): void {
  mocks.editorDialog?.onDraftChange((current) => ({
    ...buildAutomationEditDraft(makeAutomation()),
    ...(typeof current === 'object' && current !== null ? current : {}),
    ...updates
  }))
}

describe('automation editor launch options save', () => {
  installAutomationsPageHarness()

  it('clears a stale non-Grok profile before sending a create request', async () => {
    const created = makeAutomation({ id: 'new', agentId: 'claude', model: 'opus' })
    api.automations.list.mockResolvedValue([])
    scopedList([])
    api.automations.create.mockResolvedValue(created)
    await renderPage()
    await settleHostQueries()
    await act(async () => {
      mocks.listPanel?.openCreateDialog()
    })
    await act(async () => {
      updateDraft({
        name: 'Review',
        prompt: 'Review changes',
        projectId: REPO_ID,
        workspaceMode: 'existing',
        workspaceId: WORKSPACE_ID,
        agentId: 'claude',
        model: 'opus',
        reasoningEffort: '',
        agentProfile: 'minimal'
      })
    })
    await act(async () => {
      await mocks.editorDialog?.onSave()
    })
    expect(api.automations.create).toHaveBeenCalledOnce()
    expect(api.automations.create.mock.calls[0][0]).toMatchObject({
      agentId: 'claude',
      reasoningEffort: null,
      agentProfile: null
    })
  })

  it('clears a legacy profile before sending a non-Grok edit request', async () => {
    const automation = makeAutomation({ agentId: 'claude', model: 'opus', agentProfile: 'minimal' })
    api.automations.list.mockResolvedValue([automation])
    scopedList([automation])
    api.automations.update.mockResolvedValue({ ...automation, agentProfile: null })
    await renderPage()
    await settleHostQueries()
    const row = mocks.listPanel?.sortedListItems.find(
      (item) => item.kind === 'local' && item.row.automation.id === automation.id
    )
    if (!row || row.kind !== 'local') {
      throw new Error('missing automation row')
    }
    await act(async () => {
      mocks.listPanel?.openEditDialog(row.row)
    })
    await act(async () => {
      updateDraft({ agentProfile: 'minimal', reasoningEffort: '' })
    })
    await act(async () => {
      await mocks.editorDialog?.onSave()
    })
    expect(api.automations.update).toHaveBeenCalledOnce()
    expect(api.automations.update.mock.calls[0][0].updates).toMatchObject({
      agentId: 'claude',
      reasoningEffort: null,
      agentProfile: null
    })
  })
})
