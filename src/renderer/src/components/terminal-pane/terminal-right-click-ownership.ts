export type TerminalRightClickAction = 'orca-menu' | 'terminal-app' | 'paste-or-copy'

export type TerminalRightClickDecisionOptions = {
  fromTerminalContent: boolean
  mouseTrackingMode: string | undefined
  rightClickToPaste: boolean
  event: Pick<MouseEvent, 'ctrlKey' | 'altKey' | 'shiftKey'>
  isMac: boolean
}

export function resolveTerminalRightClickAction({
  fromTerminalContent,
  mouseTrackingMode,
  rightClickToPaste,
  event,
  isMac
}: TerminalRightClickDecisionOptions): TerminalRightClickAction {
  // Pane header and chrome always open Orca's menu.
  if (!fromTerminalContent) {
    return 'orca-menu'
  }

  const hasMouseTracking = mouseTrackingMode !== undefined && mouseTrackingMode !== 'none'

  if (hasMouseTracking) {
    // macOS uses Option (altKey); Linux/Windows use Shift.
    const hasOverride = isMac ? event.altKey : event.shiftKey
    if (hasOverride) {
      return 'orca-menu'
    }
    return 'terminal-app'
  }

  if (rightClickToPaste && !event.ctrlKey) {
    return 'paste-or-copy'
  }

  return 'orca-menu'
}
