// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AutomationDetail } from './AutomationDetail'
import { makeAutomation } from './automations-page-fixtures'

const roots: Root[] = []

async function renderDetail(overrides: Parameters<typeof makeAutomation>[0]): Promise<string> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(
      <TooltipProvider>
        <AutomationDetail
          automation={makeAutomation(overrides)}
          runs={[]}
          projectName="orca"
          workspaceName="main"
          projectDefaultBaseRef="main"
          runNowAvailability={null}
          now={0}
          onRunNow={vi.fn()}
          onEdit={vi.fn()}
          onToggle={vi.fn()}
          onDelete={vi.fn()}
        />
      </TooltipProvider>
    )
  })
  return container.textContent ?? ''
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(async () => {
  await act(async () => {
    roots.splice(0).forEach((root) => root.unmount())
  })
  document.body.innerHTML = ''
})

describe('AutomationDetail model display', () => {
  it('names the stored launch model', async () => {
    expect(await renderDetail({ model: 'deepseek-v4-flash' })).toContain('deepseek-v4-flash')
  })

  it('says the agent default is in charge when no model is stored', async () => {
    // An absent field must not render as a blank metric that reads like a missing value.
    expect(await renderDetail({ model: undefined })).toContain('Agent default')
  })
})
