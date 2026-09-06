import { afterEach, describe, expect, it, vi } from 'vitest'
import { computeLiveTranscriptDelta, countGraphemes } from './dictation-live-delta'

describe('computeLiveTranscriptDelta', () => {
  it('returns a no-op delta for identical text', () => {
    expect(computeLiveTranscriptDelta('你好世界', '你好世界')).toEqual({
      keepLength: 4,
      deleteGraphemes: 0,
      insertText: ''
    })
  })

  it('appends when the next partial extends the previous one', () => {
    expect(computeLiveTranscriptDelta('hello', 'hello world')).toEqual({
      keepLength: 5,
      deleteGraphemes: 0,
      insertText: ' world'
    })
  })

  it('appends Cantonese extensions without deletions', () => {
    expect(computeLiveTranscriptDelta('我想', '我想食飯')).toEqual({
      keepLength: 2,
      deleteGraphemes: 0,
      insertText: '食飯'
    })
  })

  it('rewrites only the divergent tail', () => {
    const delta = computeLiveTranscriptDelta('我想食反', '我想食飯啦')
    expect(delta.keepLength).toBe(3)
    expect(delta.deleteGraphemes).toBe(1)
    expect(delta.insertText).toBe('飯啦')
  })

  it('handles a full rewrite', () => {
    expect(computeLiveTranscriptDelta('abc', 'xyz')).toEqual({
      keepLength: 0,
      deleteGraphemes: 3,
      insertText: 'xyz'
    })
  })

  it('handles empty previous text (first partial)', () => {
    expect(computeLiveTranscriptDelta('', '你好')).toEqual({
      keepLength: 0,
      deleteGraphemes: 0,
      insertText: '你好'
    })
  })

  it('handles shrinking text (deletion only)', () => {
    expect(computeLiveTranscriptDelta('hello world', 'hello')).toEqual({
      keepLength: 5,
      deleteGraphemes: 6,
      insertText: ''
    })
  })

  it('never splits a surrogate pair', () => {
    // 𠮷 (U+20BB7) vs 𠮷野 — prefix shares the pair, then extends.
    const prev = '\u{20BB7}'
    const next = '\u{20BB7}\u91CE'
    const delta = computeLiveTranscriptDelta(prev, next)
    expect(delta.keepLength).toBe(2)
    expect(delta.deleteGraphemes).toBe(0)
    expect(delta.insertText).toBe('\u91CE')
  })

  it('does not split an emoji ZWJ family when the tail diverges', () => {
    const family = '👨‍👩‍👧'
    const prev = `${family}a`
    const next = `${family}b`
    const delta = computeLiveTranscriptDelta(prev, next)
    expect(delta.keepLength).toBe(family.length)
    expect(delta.deleteGraphemes).toBe(1)
    expect(delta.insertText).toBe('b')
  })

  it('treats divergence inside a ZWJ sequence as replacing the whole cluster', () => {
    const prev = '👨‍👩‍👧'
    const next = '👨‍👩‍👦'
    const delta = computeLiveTranscriptDelta(prev, next)
    expect(delta.keepLength).toBe(0)
    expect(delta.deleteGraphemes).toBe(1)
    expect(delta.insertText).toBe(next)
  })

  it('counts backspaces per grapheme cluster, not code unit', () => {
    const prev = 'a👍🏽b'
    const next = 'a'
    const delta = computeLiveTranscriptDelta(prev, next)
    expect(delta.keepLength).toBe(1)
    expect(delta.deleteGraphemes).toBe(2)
    expect(delta.insertText).toBe('')
  })
})

// Hermes (React Native) has no Intl.Segmenter; the module must fall back to
// code-point walking with cluster-extender rules.
describe('without Intl.Segmenter (Hermes fallback)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  async function loadFallbackModule() {
    vi.resetModules()
    const originalIntl = globalThis.Intl
    const intlWithoutSegmenter = Object.create(originalIntl) as typeof Intl
    Object.defineProperty(intlWithoutSegmenter, 'Segmenter', { value: undefined })
    vi.stubGlobal('Intl', intlWithoutSegmenter)
    return import('./dictation-live-delta.js')
  }

  it('computes Cantonese extension deltas', async () => {
    const mod = await loadFallbackModule()
    expect(mod.computeLiveTranscriptDelta('我想', '我想食飯')).toEqual({
      keepLength: 2,
      deleteGraphemes: 0,
      insertText: '食飯'
    })
  })

  it('rewrites the divergent Han tail per grapheme', async () => {
    const mod = await loadFallbackModule()
    const delta = mod.computeLiveTranscriptDelta('我想食反', '我想食飯啦')
    expect(delta.keepLength).toBe(3)
    expect(delta.deleteGraphemes).toBe(1)
    expect(delta.insertText).toBe('飯啦')
  })

  it('never splits a surrogate pair', async () => {
    const mod = await loadFallbackModule()
    const delta = mod.computeLiveTranscriptDelta('\u{20BB7}', '\u{20BB7}\u91CE')
    expect(delta.keepLength).toBe(2)
    expect(delta.deleteGraphemes).toBe(0)
    expect(delta.insertText).toBe('\u91CE')
  })

  it('keeps ZWJ emoji sequences whole', async () => {
    const mod = await loadFallbackModule()
    const family = '👨‍👩‍👧'
    const delta = mod.computeLiveTranscriptDelta(`${family}a`, `${family}b`)
    expect(delta.keepLength).toBe(family.length)
    expect(delta.deleteGraphemes).toBe(1)
    expect(delta.insertText).toBe('b')
    expect(mod.countGraphemes(family)).toBe(1)
  })

  it('counts skin-tone emoji as one cluster', async () => {
    const mod = await loadFallbackModule()
    expect(mod.countGraphemes('👍🏽')).toBe(1)
    expect(mod.computeLiveTranscriptDelta('a👍🏽b', 'a').deleteGraphemes).toBe(2)
  })
})

describe('countGraphemes', () => {
  it('counts plain ASCII', () => {
    expect(countGraphemes('hello')).toBe(5)
  })

  it('counts Han characters individually', () => {
    expect(countGraphemes('廣東話輸入')).toBe(5)
  })

  it('counts a ZWJ emoji family as one cluster', () => {
    expect(countGraphemes('👨‍👩‍👧')).toBe(1)
  })

  it('counts a skin-tone emoji as one cluster', () => {
    expect(countGraphemes('👍🏽')).toBe(1)
  })

  it('returns zero for empty text', () => {
    expect(countGraphemes('')).toBe(0)
  })
})
