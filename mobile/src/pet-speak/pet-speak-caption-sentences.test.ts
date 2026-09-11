import { describe, expect, it } from 'vitest'
import { findActiveSentenceIndex, splitCaptionSentences } from './pet-speak-caption-sentences'

describe('splitCaptionSentences', () => {
  it('splits on fullwidth 。！？ and newlines unconditionally', () => {
    const text = '第一句。第二句！第三句？第四句\n第五句\r\n第六句'
    const sentences = splitCaptionSentences(text)
    expect(sentences.map((s) => s.text)).toEqual([
      '第一句。',
      '第二句！',
      '第三句？',
      '第四句',
      '第五句',
      '第六句'
    ])
  })

  it('splits on ASCII . ! ? only when followed by whitespace or end of text', () => {
    const text = 'Sentence one. Sentence two! Sentence three? Last sentence.'
    const sentences = splitCaptionSentences(text)
    expect(sentences.map((s) => s.text)).toEqual([
      'Sentence one.',
      'Sentence two!',
      'Sentence three?',
      'Last sentence.'
    ])
  })

  it('attaches trailing closers 」』"\')] to current sentence', () => {
    const text = '佢話「好！」」接着講「係咩？)」。'
    const sentences = splitCaptionSentences(text)
    expect(sentences.map((s) => s.text)).toEqual(['佢話「好！」」', '接着講「係咩？)」。'])
  })

  it('does NOT split on ellipsis …', () => {
    const text = '等等……唔好住。'
    const sentences = splitCaptionSentences(text)
    expect(sentences.map((s) => s.text)).toEqual(['等等……唔好住。'])
  })

  it('handles fixture: two Cantonese sentences embedding cmux (stale-or-superseded) and 2026-08-10-grok-build-init-pvelxc-3adc3628', () => {
    const text =
      "我哋點樣 reconcile '2026-08-10-grok-build-init-pvelxc-3adc3628' 喺 cmux (stale-or-superseded) 呀？請話畀我聽。"
    const sentences = splitCaptionSentences(text)
    expect(sentences.map((s) => s.text)).toEqual([
      "我哋點樣 reconcile '2026-08-10-grok-build-init-pvelxc-3adc3628' 喺 cmux (stale-or-superseded) 呀？",
      '請話畀我聽。'
    ])
  })

  it('provides correct start and end offsets matching string slice', () => {
    const text = '第一句。第二句！'
    const sentences = splitCaptionSentences(text)
    expect(sentences).toHaveLength(2)
    expect(text.slice(sentences[0].start, sentences[0].end)).toBe(sentences[0].text)
    expect(text.slice(sentences[1].start, sentences[1].end)).toBe(sentences[1].text)
  })

  it('returns single item for delimiter-free text', () => {
    const text = '冇標點符號嘅一句說話'
    const sentences = splitCaptionSentences(text)
    expect(sentences).toHaveLength(1)
    expect(sentences[0].text).toBe(text)
  })

  it('handles empty text', () => {
    expect(splitCaptionSentences('')).toEqual([])
  })
})

describe('findActiveSentenceIndex & karaoke sentence paging', () => {
  const text = '第一句。第二句！'
  const sentences = splitCaptionSentences(text)
  // '第一句。' has length 4 (indices 0..4)
  // '第二句！' has length 4 (indices 4..8)

  it('highlight at last code point of sentence 1 still shows sentence 1', () => {
    // index 3 is '。', end is 4
    const idx = findActiveSentenceIndex(sentences, { start: 3, end: 4 })
    expect(idx).toBe(0)
  })

  it('first highlight past terminator shows sentence 2', () => {
    // index 4 is '第' (of sentence 2)
    const idx = findActiveSentenceIndex(sentences, { start: 4, end: 5 })
    expect(idx).toBe(1)
  })

  it('returns index 0 when range is null or undefined', () => {
    expect(findActiveSentenceIndex(sentences, null)).toBe(0)
    expect(findActiveSentenceIndex(sentences, undefined)).toBe(0)
  })
})
