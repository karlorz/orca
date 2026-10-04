import type { TerminalFocusEvidence } from './terminal-reveal-identity'

export type RuntimeTerminalFocus = TerminalFocusEvidence & {
  handle: string
  tabId: string
  worktreeId: string
  navigated?: boolean
}
