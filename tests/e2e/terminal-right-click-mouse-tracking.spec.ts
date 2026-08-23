import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { Page, TestInfo } from '@playwright/test'
import { test, expect } from './helpers/orca-app'
import {
  execInTerminal,
  sendToTerminal,
  waitForActivePanePtyId,
  waitForActiveTerminalManager,
  waitForPaneCount,
  waitForTerminalOutput
} from './helpers/terminal'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'

const FIXTURE_PATH = path.join(
  process.cwd(),
  'tests/e2e/fixtures/terminal-link-mouse-owner-fixture.cjs'
)

type TerminalTarget = { x: number; y: number; mouseTrackingMode: string }

async function startMouseAwareTuiFixture(
  orcaPage: Page,
  testInfo: TestInfo
): Promise<{ mouseLogPath: string; ptyId: string; target: TerminalTarget }> {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await ensureTerminalVisible(orcaPage)
  await waitForActiveTerminalManager(orcaPage)
  await waitForPaneCount(orcaPage, 1)

  const ptyId = await waitForActivePanePtyId(orcaPage)
  const mouseLogPath = testInfo.outputPath('child-mouse-reports.log')
  await execInTerminal(
    orcaPage,
    ptyId,
    `node ${JSON.stringify(FIXTURE_PATH)} ${JSON.stringify(mouseLogPath)} http`
  )
  await waitForTerminalOutput(orcaPage, 'LINK_MOUSE_READY')

  const target = await orcaPage.evaluate(() => {
    const state = window.__store?.getState()
    const worktreeId = state?.activeWorktreeId
    const tabId = worktreeId ? state?.activeTabIdByWorktree?.[worktreeId] : null
    const manager = tabId ? window.__paneManagers?.get(tabId) : null
    const pane = manager?.getActivePane?.() ?? manager?.getPanes?.()[0] ?? null
    const screen = pane?.terminal.element?.querySelector<HTMLElement>('.xterm-screen') ?? null
    if (!pane || !screen) {
      throw new Error('Active terminal screen unavailable')
    }

    const rect = screen.getBoundingClientRect()
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      mouseTrackingMode: pane.terminal.modes.mouseTrackingMode
    }
  })

  expect(target.mouseTrackingMode).not.toBe('none')
  return { mouseLogPath, ptyId, target }
}

function childMouseReportCount(mouseLogPath: string): number {
  if (!existsSync(mouseLogPath)) {
    return 0
  }
  return readFileSync(mouseLogPath, 'utf8').trim().split(/\s+/).filter(Boolean).length
}

async function expectChildMouseReports(mouseLogPath: string): Promise<void> {
  await expect
    .poll(() => childMouseReportCount(mouseLogPath), { timeout: 5_000 })
    .toBeGreaterThan(0)
}

test.describe('terminal right-click mouse tracking ownership', () => {
  test('ordinary right-click with active mouse tracking is owned by child TUI and emits PTY mouse bytes without opening Orca menu', async ({
    orcaPage
  }, testInfo) => {
    const { mouseLogPath, ptyId, target } = await startMouseAwareTuiFixture(orcaPage, testInfo)

    await orcaPage.mouse.click(target.x, target.y, { button: 'right' })

    // TUI receives mouse report from xterm
    await expectChildMouseReports(mouseLogPath)

    // Orca's context menu must NOT open
    await expect(orcaPage.getByText('Set Title…', { exact: true })).toHaveCount(0)

    await sendToTerminal(orcaPage, ptyId, 'q')
  })

  test('rightClickToPaste cannot paste while mouse tracking is active', async ({
    orcaPage
  }, testInfo) => {
    const { mouseLogPath, ptyId, target } = await startMouseAwareTuiFixture(orcaPage, testInfo)

    await orcaPage.evaluate(async () => {
      await window.__store?.getState().updateSettings({ terminalRightClickToPaste: true })
    })

    await orcaPage.mouse.click(target.x, target.y, { button: 'right' })

    // TUI receives mouse report; clipboard paste must not occur
    await expectChildMouseReports(mouseLogPath)
    await expect(orcaPage.getByText('Set Title…', { exact: true })).toHaveCount(0)

    await sendToTerminal(orcaPage, ptyId, 'q')
  })

  test('macOS Option (Alt) override opens Orca context menu on active mouse tracking', async ({
    orcaPage
  }, testInfo) => {
    const { ptyId, target } = await startMouseAwareTuiFixture(orcaPage, testInfo)

    await orcaPage.evaluate(
      ({ x, y }) => {
        const state = window.__store?.getState()
        const worktreeId = state?.activeWorktreeId
        const tabId = worktreeId ? state?.activeTabIdByWorktree?.[worktreeId] : null
        const manager = tabId ? window.__paneManagers?.get(tabId) : null
        const pane = manager?.getActivePane?.() ?? manager?.getPanes?.()[0] ?? null
        const screen = pane?.terminal.element?.querySelector<HTMLElement>('.xterm-screen') ?? null
        if (!screen) {
          throw new Error('Screen element unavailable')
        }
        const event = new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          button: 2,
          altKey: true
        })
        screen.dispatchEvent(event)
      },
      { x: target.x, y: target.y }
    )

    // Orca context menu opens
    await expect(orcaPage.getByText('Set Title…', { exact: true })).toBeVisible()

    await sendToTerminal(orcaPage, ptyId, 'q')
  })

  test('pane title header right-click is always Orca-owned even with active mouse tracking', async ({
    orcaPage
  }, testInfo) => {
    const { ptyId } = await startMouseAwareTuiFixture(orcaPage, testInfo)

    // First open context menu via Option override to set a pane title
    await orcaPage.evaluate(() => {
      const state = window.__store?.getState()
      const worktreeId = state?.activeWorktreeId
      const tabId = worktreeId ? state?.activeTabIdByWorktree?.[worktreeId] : null
      const manager = tabId ? window.__paneManagers?.get(tabId) : null
      const pane = manager?.getActivePane?.() ?? manager?.getPanes?.()[0] ?? null
      const screen = pane?.terminal.element?.querySelector<HTMLElement>('.xterm-screen') ?? null
      if (!screen) {
        throw new Error('Screen element unavailable')
      }
      const rect = screen.getBoundingClientRect()
      screen.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          button: 2,
          altKey: true
        })
      )
    })

    await expect(orcaPage.getByText('Set Title…', { exact: true })).toBeVisible()
    await orcaPage.getByText('Set Title…', { exact: true }).click()

    const titleInput = orcaPage.locator('.pane-title-input').first()
    await expect(titleInput).toBeVisible()
    await titleInput.fill('TUI Pane Title')
    await titleInput.press('Enter')
    await expect(titleInput).toHaveCount(0)

    const titleBar = orcaPage.locator('.pane-title-bar', { hasText: 'TUI Pane Title' }).first()
    await expect(titleBar).toBeVisible()

    // Plain right-click on the pane title header must open Orca menu without Option/Alt modifier
    await titleBar.dispatchEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 })

    await expect(orcaPage.getByText('Set Title…', { exact: true })).toBeVisible()

    await sendToTerminal(orcaPage, ptyId, 'q')
  })
})
