import type { TerminalDocumentScope } from './document-scope'

export function getCellHeight(scope: TerminalDocumentScope) {
  if (!scope.term || !scope.term._core) {
    return 15
  }
  const dimensions = scope.term._core._renderService?.dimensions
  return dimensions?.css.cell.height || 15
}

export function getCellWidth(scope: TerminalDocumentScope) {
  if (!scope.term || !scope.term._core) {
    return 0
  }
  const dimensions = scope.term._core._renderService?.dimensions
  return dimensions?.css.cell.width || 0
}
