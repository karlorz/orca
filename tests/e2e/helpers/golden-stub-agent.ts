import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { expect } from '@stablyai/playwright-test'
import { TUI_AGENT_DISPLAY_NAMES } from '../../../src/shared/tui-agent-display-names'
import type { BuiltInWindowsTerminalShell } from '../../../src/shared/windows-terminal-shell'
import { readActiveScreen } from './alt-screen-frame'
import { focusActiveTerminalInput, getTerminalContent, resolveActiveTabId } from './terminal'

export const GOLDEN_STUB_READY_MARKER = 'GOLDEN_STUB_AGENT_READY'
export const GOLDEN_STUB_EXIT_MARKER = 'GOLDEN_STUB_AGENT_EXITED'

/** Agents exposed by the fixture directory for tab-bar detection. */
export const GOLDEN_STUB_AGENTS = [
  { id: 'codex', menuItemName: TUI_AGENT_DISPLAY_NAMES.codex },
  { id: 'claude', menuItemName: TUI_AGENT_DISPLAY_NAMES.claude }
] as const

/** Matches the catalog label plus an optional keyboard-shortcut suffix. */
export function goldenStubMenuItemName(agentLabel: string): RegExp {
  const escaped = agentLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${escaped}(?:\\s+(?:Ctrl|Cmd|Alt|Shift|[⌘⌃⇧⌥]).*)?$`, 'i')
}

export function goldenStubMenuItemMatches(accessibleName: string, agentLabel: string): boolean {
  return goldenStubMenuItemName(agentLabel).test(accessibleName)
}

const fixtureDir = path.join(process.cwd(), 'tests', 'e2e', 'fixtures', 'golden-stub-agent')

export function getGoldenStubAgentLaunchEnv(): NodeJS.ProcessEnv {
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'PATH'
  return {
    [pathKey]: [fixtureDir, process.env[pathKey] ?? ''].filter(Boolean).join(path.delimiter)
  }
}

export async function configureGoldenStubAgent(
  page: Page,
  options: {
    agent?: (typeof GOLDEN_STUB_AGENTS)[number]['id'] | 'grok'
    agentArgs?: string
    /** Windows default shell the launch command must survive; ignored elsewhere. */
    windowsShell?: BuiltInWindowsTerminalShell
  } = {}
): Promise<void> {
  const agent = options.agent ?? 'codex'
  await page.evaluate(
    async ({ agent, agentArgs, windowsShell }) => {
      const store = window.__store
      if (!store) {
        throw new Error('Orca store is unavailable')
      }
      await store.getState().updateSettings({
        defaultTuiAgent: agent,
        agentCmdOverrides: { [agent]: 'golden-stub-agent' },
        agentDefaultArgs: { [agent]: agentArgs },
        ...(windowsShell ? { terminalWindowsShell: windowsShell } : {})
      })
    },
    { agent, agentArgs: options.agentArgs ?? '', windowsShell: options.windowsShell ?? null }
  )
}

async function waitForGoldenStubReady(page: Page, timeoutMs: number): Promise<void> {
  await expect
    .poll(
      async () => {
        if ((await getTerminalContent(page)).includes(GOLDEN_STUB_READY_MARKER)) {
          return true
        }
        const tabId = await resolveActiveTabId(page)
        if (!tabId) {
          return false
        }
        const screen = await readActiveScreen(page, tabId)
        return screen?.rows.some((row) => row.includes(GOLDEN_STUB_READY_MARKER)) === true
      },
      {
        timeout: timeoutMs,
        message: `Terminal did not contain "${GOLDEN_STUB_READY_MARKER}"`
      }
    )
    .toBe(true)
}

export async function launchGoldenStubAgentFromNewTab(
  page: Page,
  menuItemName: string | RegExp = TUI_AGENT_DISPLAY_NAMES.codex
): Promise<void> {
  await page.getByRole('button', { name: 'New tab' }).click({ force: true })
  const launchOption =
    typeof menuItemName === 'string'
      ? page.getByRole('menuitem', { name: goldenStubMenuItemName(menuItemName) })
      : page.getByRole('menuitem', { name: menuItemName }).first()
  await expect(launchOption).toBeVisible({ timeout: 15_000 })
  await launchOption.click({ force: true })
  await focusActiveTerminalInput(page)
  await waitForGoldenStubReady(page, 45_000)
}
