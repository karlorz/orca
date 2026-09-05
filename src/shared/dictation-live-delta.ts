// Replace-in-place delta between two successive live-dictation transcripts.
//
// Why: Apple Speech partials rewrite the in-progress utterance (especially for
// Cantonese/Chinese). Live insertion must delete only the divergent tail and
// type the new suffix, never duplicating text or splitting grapheme clusters —
// terminal targets delete via backspace presses that operate on whole
// graphemes, so the kept common prefix must end on a grapheme boundary in BOTH
// the previous and the next text.

export type LiveTranscriptDelta = {
  // UTF-16 length of the kept common prefix (same slice index in prev and next).
  keepLength: number
  // Backspace presses needed to delete prev.slice(keepLength): grapheme clusters.
  deleteGraphemes: number
  // Text to type after deleting: next.slice(keepLength).
  insertText: string
}

type GraphemeSegmenter = { segment(input: string): Iterable<{ index: number }> }

function createSegmenter(): GraphemeSegmenter | null {
  const intl = Intl as unknown as {
    Segmenter?: new (locale?: string, options?: { granularity: string }) => GraphemeSegmenter
  }
  if (typeof intl.Segmenter !== 'function') {
    return null
  }
  try {
    return new intl.Segmenter(undefined, { granularity: 'grapheme' })
  } catch {
    return null
  }
}

const segmenter = createSegmenter()

const ZWJ = 0x200d

// Fallback cluster-extender detection for runtimes without Intl.Segmenter
// (Hermes). A code point that extends the preceding cluster: combining marks,
// variation selectors, ZWJ, and emoji skin-tone modifiers. Enough for the
// Cantonese/Latin dictation path plus common emoji; Han characters are all
// single-code-point single-grapheme and unaffected.
function isClusterExtender(codePoint: number): boolean {
  return (
    codePoint === ZWJ ||
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f) || // variation selectors
    (codePoint >= 0x0300 && codePoint <= 0x036f) || // combining diacritics
    (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
    (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
    (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
    (codePoint >= 0x1f3fb && codePoint <= 0x1f3ff) // skin-tone modifiers
  )
}

function isRegionalIndicator(codePoint: number): boolean {
  return codePoint >= 0x1f1e6 && codePoint <= 0x1f1ff
}

// Grapheme boundary offsets of text (UTF-16 indices), ascending, up to and
// including `limit` (and text.length when text.length <= limit). Always
// includes 0.
function graphemeBoundariesUpTo(text: string, limit: number): number[] {
  if (segmenter) {
    const boundaries: number[] = [0]
    for (const segment of segmenter.segment(text)) {
      if (segment.index > 0 && segment.index <= limit) {
        boundaries.push(segment.index)
      }
      if (segment.index > limit) {
        return boundaries
      }
    }
    if (text.length <= limit) {
      boundaries.push(text.length)
    }
    return boundaries
  }
  // Fallback: walk code points. A boundary is invalid before a cluster
  // extender, immediately after a ZWJ, or between the two halves of a
  // regional-indicator (flag) pair.
  const boundaries: number[] = [0]
  let index = 0
  let previousCodePoint = -1
  let openRegionalIndicatorPair = false
  while (index < text.length) {
    const codePoint = text.codePointAt(index) as number
    const width = codePoint > 0xffff ? 2 : 1
    if (index > 0 && index <= limit) {
      const joinsFlagPair =
        isRegionalIndicator(codePoint) &&
        previousCodePoint >= 0 &&
        isRegionalIndicator(previousCodePoint) &&
        openRegionalIndicatorPair
      const validBoundary =
        !isClusterExtender(codePoint) && previousCodePoint !== ZWJ && !joinsFlagPair
      if (validBoundary) {
        boundaries.push(index)
      }
    }
    if (isRegionalIndicator(codePoint)) {
      openRegionalIndicatorPair = !openRegionalIndicatorPair
    } else {
      openRegionalIndicatorPair = false
    }
    previousCodePoint = codePoint
    index += width
  }
  if (text.length <= limit) {
    boundaries.push(text.length)
  }
  return boundaries
}

export function countGraphemes(text: string): number {
  if (!text) {
    return 0
  }
  if (segmenter) {
    let count = 0
    for (const segment of segmenter.segment(text)) {
      void segment
      count += 1
    }
    return count
  }
  // Boundaries include 0 and text.length; cluster count is boundaries - 1.
  return Math.max(graphemeBoundariesUpTo(text, text.length).length - 1, 0)
}

function rawCommonPrefixLength(prev: string, next: string): number {
  const max = Math.min(prev.length, next.length)
  let index = 0
  while (index < max && prev.charCodeAt(index) === next.charCodeAt(index)) {
    index += 1
  }
  return index
}

export function computeLiveTranscriptDelta(prev: string, next: string): LiveTranscriptDelta {
  if (prev === next) {
    return { keepLength: prev.length, deleteGraphemes: 0, insertText: '' }
  }
  const rawPrefix = rawCommonPrefixLength(prev, next)
  const nextBoundaries = new Set(graphemeBoundariesUpTo(next, rawPrefix))
  let keepLength = 0
  for (const boundary of graphemeBoundariesUpTo(prev, rawPrefix)) {
    if (boundary <= rawPrefix && boundary > keepLength && nextBoundaries.has(boundary)) {
      keepLength = boundary
    }
  }
  return {
    keepLength,
    deleteGraphemes: countGraphemes(prev.slice(keepLength)),
    insertText: next.slice(keepLength)
  }
}
