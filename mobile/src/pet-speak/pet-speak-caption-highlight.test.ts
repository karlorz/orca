import { describe, expect, it } from 'vitest'
import { splitCaptionHighlight } from './pet-speak-caption-highlight'

describe('splitCaptionHighlight', () => {
  it('returns the whole line unhighlighted when no range is set', () => {
    expect(splitCaptionHighlight('你好世界', null)).toEqual([
      { text: '你好世界', highlighted: false }
    ])
  })

  it('highlights only the current engine range so karaoke can paint a background', () => {
    expect(splitCaptionHighlight('你好世界', { start: 2, end: 4 })).toEqual([
      { text: '你好', highlighted: false },
      { text: '世界', highlighted: true }
    ])
  })

  it('clamps an out-of-range span instead of throwing', () => {
    expect(splitCaptionHighlight('ab', { start: -3, end: 99 })).toEqual([
      { text: 'ab', highlighted: true }
    ])
  })

  it('ignores an empty or inverted range', () => {
    expect(splitCaptionHighlight('ab', { start: 2, end: 2 })).toEqual([
      { text: 'ab', highlighted: false }
    ])
    expect(splitCaptionHighlight('ab', { start: 2, end: 1 })).toEqual([
      { text: 'ab', highlighted: false }
    ])
  })
})
