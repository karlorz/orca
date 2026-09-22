import type { TerminalDocumentScope, TerminalDocumentSelection } from './document-scope'

export type TerminalSelectionRange = {
  start: TerminalDocumentSelection['anchor']
  end: TerminalDocumentSelection['anchor']
}

export function isStartFirst(
  a: TerminalDocumentSelection['anchor'],
  b: TerminalDocumentSelection['anchor']
) {
  if (a.row !== b.row) {
    return a.row < b.row
  }
  return a.col <= b.col
}

export function selRange(scope: TerminalDocumentScope): TerminalSelectionRange | null {
  if (!scope.sel) {
    return null
  }
  if (isStartFirst(scope.sel.anchor, scope.sel.focus)) {
    return { start: scope.sel.anchor, end: scope.sel.focus }
  }
  return { start: scope.sel.focus, end: scope.sel.anchor }
}

export function applyXtermSelection(scope: TerminalDocumentScope) {
  if (!scope.term || !scope.sel) {
    return
  }
  const r = selRange(scope)
  if (!r) {
    return
  }
  let length: number
  if (r.start.row === r.end.row) {
    length = Math.max(1, r.end.col - r.start.col + 1)
  } else {
    const first = scope.term.cols - r.start.col
    const middle = Math.max(0, r.end.row - r.start.row - 1) * scope.term.cols
    const last = r.end.col + 1
    length = first + middle + last
  }
  try {
    scope.term.select(r.start.col, r.start.row, length)
  } catch {}
}
