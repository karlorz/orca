import { hasActiveMouseTracking } from './terminal-right-click-ownership'

type RightClickPasteMouseEvent = {
  button: number
  ctrlKey: boolean
  preventDefault: () => void
  stopPropagation: () => void
}

/**
 * Why: with "Right-click to paste" on and no TUI mouse tracking, Orca owns the
 * right button so xterm cannot also report the press (#25192). Active mouse
 * tracking yields to the TUI: claiming the capture-phase press would swallow
 * PTY mouse bytes. Ctrl+right-click stays the app menu.
 */
export function isTerminalRightClickPasteGesture(
  event: Pick<RightClickPasteMouseEvent, 'button' | 'ctrlKey'>,
  rightClickToPaste: boolean,
  mouseTrackingMode?: string
): boolean {
  if (hasActiveMouseTracking(mouseTrackingMode)) {
    return false
  }
  return rightClickToPaste && event.button === 2 && !event.ctrlKey
}

/** Stop the press before xterm's listener and keep the focus xterm would have taken. */
export function claimTerminalRightClickPasteMouseDown(
  event: RightClickPasteMouseEvent,
  terminal: { focus: () => void }
): void {
  event.preventDefault()
  event.stopPropagation()
  terminal.focus()
}
