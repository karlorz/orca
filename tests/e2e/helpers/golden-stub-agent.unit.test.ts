import { expect, it } from 'vitest'
import { TUI_AGENT_DISPLAY_NAMES } from '../../../src/shared/tui-agent-display-names'
import {
  GOLDEN_STUB_AGENTS,
  goldenStubMenuItemMatches,
  goldenStubMenuItemName
} from './golden-stub-agent'

it('clicks Claude by label plus optional shortcut so Claude Agent Teams is not selected', () => {
  expect(GOLDEN_STUB_AGENTS.map((agent) => [agent.id, agent.menuItemName])).toEqual([
    ['codex', TUI_AGENT_DISPLAY_NAMES.codex],
    ['claude', TUI_AGENT_DISPLAY_NAMES.claude]
  ])
  const claude = TUI_AGENT_DISPLAY_NAMES.claude
  const teams = TUI_AGENT_DISPLAY_NAMES['claude-agent-teams']
  expect(goldenStubMenuItemMatches(claude, claude)).toBe(true)
  expect(goldenStubMenuItemMatches(`${claude} Ctrl+N`, claude)).toBe(true)
  expect(goldenStubMenuItemMatches(`${claude} ⌥⌘T`, claude)).toBe(true)
  expect(goldenStubMenuItemMatches(teams, claude)).toBe(false)
  expect(goldenStubMenuItemName(claude).test(teams)).toBe(false)
  expect(new RegExp('^Claude(?:\\s|$)', 'i').test(teams)).toBe(true)
})
