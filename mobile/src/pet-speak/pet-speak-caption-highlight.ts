export type CaptionHighlightRange = {
  start: number
  end: number
}

export type CaptionTextSegment = {
  text: string
  highlighted: boolean
}

export function splitCaptionHighlight(
  text: string,
  range: CaptionHighlightRange | null | undefined
): CaptionTextSegment[] {
  if (!text) {
    return []
  }
  if (!range) {
    return [{ text, highlighted: false }]
  }
  const start = Math.max(0, Math.min(text.length, Math.floor(range.start)))
  const end = Math.max(start, Math.min(text.length, Math.floor(range.end)))
  if (end <= start) {
    return [{ text, highlighted: false }]
  }
  const segments: CaptionTextSegment[] = []
  if (start > 0) {
    segments.push({ text: text.slice(0, start), highlighted: false })
  }
  segments.push({ text: text.slice(start, end), highlighted: true })
  if (end < text.length) {
    segments.push({ text: text.slice(end), highlighted: false })
  }
  return segments
}
