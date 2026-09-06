import { countGraphemes } from '../../../../shared/dictation-live-delta'

export type TerminalBufferLineForDictationCap = {
  isWrapped: boolean
  translateToString(trimRight?: boolean, startCol?: number, endCol?: number): string
}

export type TerminalBufferForDictationCap = {
  cursorX: number
  cursorY: number
  // Why: xterm cursorY is viewport-relative; getLine is absolute. Missing
  // baseY reads scrollback and can uncap a keepLength-0 rewrite.
  baseY?: number
  getLine(y: number): TerminalBufferLineForDictationCap | undefined
}

function findLongestMatchingLiveSuffix(behindCursorText: string, liveSegment: string): string {
  if (!behindCursorText || !liveSegment) {
    return ''
  }
  const maxMatchLength = Math.min(behindCursorText.length, liveSegment.length)
  for (let len = maxMatchLength; len > 0; len--) {
    const liveSuffix = liveSegment.slice(-len)
    if (behindCursorText.endsWith(liveSuffix)) {
      return liveSuffix
    }
  }
  return ''
}

export function capDictationBackspaces(args: {
  buffer?: TerminalBufferForDictationCap | null
  requestedBackspaces: number
  liveSegment?: string
}): number {
  const { buffer, requestedBackspaces, liveSegment } = args
  if (!buffer) {
    return requestedBackspaces
  }
  if (requestedBackspaces <= 0) {
    return 0
  }
  if (liveSegment === undefined) {
    return requestedBackspaces
  }
  if (!liveSegment) {
    return 0
  }

  const cursorX = Math.max(0, buffer.cursorX)
  const cursorLine = Math.max(0, (buffer.baseY ?? 0) + buffer.cursorY)
  const currentLine = buffer.getLine(cursorLine)
  if (!currentLine) {
    return requestedBackspaces
  }

  let behindCursorText = currentLine.translateToString(false, 0, cursorX)

  let row = cursorLine
  while (row > 0 && buffer.getLine(row)?.isWrapped) {
    row--
    const prevLine = buffer.getLine(row)
    if (!prevLine) {
      break
    }
    behindCursorText = prevLine.translateToString(true) + behindCursorText
  }

  // 2. Find longest suffix of liveSegment that is a suffix of behindCursorText.
  const matchingSuffix = findLongestMatchingLiveSuffix(behindCursorText, liveSegment)
  const matchingGraphemes = countGraphemes(matchingSuffix)

  // 3. Return min(requestedBackspaces, grapheme count of matched suffix).
  return Math.min(requestedBackspaces, matchingGraphemes)
}
