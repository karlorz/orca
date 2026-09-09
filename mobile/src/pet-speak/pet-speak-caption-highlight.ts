export type CaptionHighlightRange = {
  start: number
  end: number
}

export type CaptionTextSegment = {
  text: string
  highlighted: boolean
  start: number
}

export function splitCaptionHighlight(
  text: string,
  range: CaptionHighlightRange | null | undefined
): CaptionTextSegment[] {
  if (!text) {
    return []
  }
  if (!range) {
    return [{ text, highlighted: false, start: 0 }]
  }
  const start = Math.max(0, Math.min(text.length, Math.floor(range.start)))
  const end = Math.max(start, Math.min(text.length, Math.floor(range.end)))
  if (end <= start) {
    return [{ text, highlighted: false, start: 0 }]
  }
  const segments: CaptionTextSegment[] = []
  if (start > 0) {
    segments.push({ text: text.slice(0, start), highlighted: false, start: 0 })
  }
  segments.push({ text: text.slice(start, end), highlighted: true, start })
  if (end < text.length) {
    segments.push({ text: text.slice(end), highlighted: false, start: end })
  }
  return segments
}
