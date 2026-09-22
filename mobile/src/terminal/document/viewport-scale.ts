import type { TerminalDocumentScope } from './document-scope'

export function getTotalScale(scope: TerminalDocumentScope) {
  return scope.currentScale * scope.userScale
}
