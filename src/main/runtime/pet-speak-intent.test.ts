import { describe, expect, it } from 'vitest'
import { parseSpeakIntentDecision, parseSpeakIntentMessage } from './pet-speak-intent'
import { PET_SPEAK_MAX_TEXT_GRAPHEMES } from '../../shared/pet-speak-limits'

describe('PET_SPEAK_MAX_TEXT_GRAPHEMES', () => {
  it('is exactly 2000', () => {
    expect(PET_SPEAK_MAX_TEXT_GRAPHEMES).toBe(2000)
  })
})

describe('parseSpeakIntentDecision - text length & validation', () => {
  it('accepts 91-char ask', () => {
    const text91 =
      "我哋點樣 reconcile '2026-08-10-grok-build-init-pvelxc-3adc3628' 喺 cmux (stale-or-superseded) 呀？"
    expect(Array.from(text91).length).toBe(91)
    const decision = parseSpeakIntentDecision({
      kind: 'speak-intent',
      text: text91
    })
    expect(decision).toEqual({
      ok: true,
      charsCount: 91,
      event: expect.objectContaining({
        type: 'pet.speak',
        text: text91
      })
    })
    // Also parseSpeakIntentMessage returns valid result
    const legacy = parseSpeakIntentMessage({
      kind: 'speak-intent',
      text: text91
    })
    expect(legacy).not.toBeNull()
    expect(legacy!.charsCount).toBe(91)
    expect(legacy!.event.text).toBe(text91)
  })

  it('accepts 99-char similar ask', () => {
    const base =
      "我哋點樣 reconcile '2026-08-10-grok-build-init-pvelxc-3adc3628' 喺 cmux (stale-or-superseded) 呀？"
    const text99 = `${base}12345678`
    expect(Array.from(text99).length).toBe(99)
    const decision = parseSpeakIntentDecision({
      kind: 'speak-intent',
      text: text99
    })
    expect(decision.ok).toBe(true)
    if (decision.ok) {
      expect(decision.charsCount).toBe(99)
      expect(decision.event.text).toBe(text99)
    }
  })

  it('accepts 70-char regression', () => {
    const text70 = 'A'.repeat(70)
    expect(Array.from(text70).length).toBe(70)
    const decision = parseSpeakIntentDecision({
      kind: 'speak-intent',
      text: text70
    })
    expect(decision.ok).toBe(true)
    if (decision.ok) {
      expect(decision.charsCount).toBe(70)
      expect(decision.event.text).toBe(text70)
    }
  })

  it('accepts exactly 2000 code points', () => {
    const text2000 = '粵'.repeat(2000)
    expect(Array.from(text2000).length).toBe(2000)
    const decision = parseSpeakIntentDecision({
      kind: 'speak-intent',
      text: text2000
    })
    expect(decision.ok).toBe(true)
    if (decision.ok) {
      expect(decision.charsCount).toBe(2000)
      expect(decision.event.text).toBe(text2000)
    }
  })

  it('rejects 2001 code points with reason "length"', () => {
    const text2001 = '粵'.repeat(2001)
    expect(Array.from(text2001).length).toBe(2001)
    const decision = parseSpeakIntentDecision({
      kind: 'speak-intent',
      event_id: 'ev-long-1',
      text: text2001
    })
    expect(decision).toEqual({
      ok: false,
      reason: 'length',
      event_id: 'ev-long-1',
      charsCount: 2001
    })
    expect(
      parseSpeakIntentMessage({
        kind: 'speak-intent',
        event_id: 'ev-long-1',
        text: text2001
      })
    ).toBeNull()
  })

  it('rejects empty with reason "empty"', () => {
    const decision = parseSpeakIntentDecision({
      kind: 'speak-intent',
      event_id: 'ev-empty-1',
      text: '   '
    })
    expect(decision).toEqual({
      ok: false,
      reason: 'empty',
      event_id: 'ev-empty-1',
      charsCount: 0
    })
    expect(
      parseSpeakIntentMessage({
        kind: 'speak-intent',
        event_id: 'ev-empty-1',
        text: '   '
      })
    ).toBeNull()
  })

  it('ZWJ fixture: rejects text whose code-point count is >2000 even if grapheme cluster count might differ', () => {
    // 👨‍👩‍👧‍👦 is 7 unicode code points (man, ZWJ, woman, ZWJ, girl, ZWJ, boy) but 1 grapheme cluster
    const zwjFamily = '👨‍👩‍👧‍👦'
    expect(Array.from(zwjFamily).length).toBe(7)
    // 286 * 7 = 2002 code points
    const zwjText = zwjFamily.repeat(286)
    const codePointCount = Array.from(zwjText).length
    expect(codePointCount).toBe(2002)
    const decision = parseSpeakIntentDecision({
      kind: 'speak-intent',
      event_id: 'ev-zwj-1',
      text: zwjText
    })
    expect(decision).toEqual({
      ok: false,
      reason: 'length',
      event_id: 'ev-zwj-1',
      charsCount: 2002
    })
  })
})

describe('parseSpeakIntentMessage - original_text', () => {
  it('parses valid original_text and trims whitespace', () => {
    const parsed = parseSpeakIntentMessage({
      kind: 'speak-intent',
      text: '你好',
      original_text: '  Hello from English source!  '
    })
    expect(parsed).not.toBeNull()
    expect(parsed!.event.original_text).toBe('Hello from English source!')
  })

  it('omits original_text when absent, undefined, or not a string', () => {
    const parsed1 = parseSpeakIntentMessage({
      kind: 'speak-intent',
      text: '你好'
    })
    expect(parsed1).not.toBeNull()
    expect(parsed1!.event.original_text).toBeUndefined()
    expect('original_text' in parsed1!.event).toBe(false)

    const parsed2 = parseSpeakIntentMessage({
      kind: 'speak-intent',
      text: '你好',
      original_text: null
    })
    expect(parsed2).not.toBeNull()
    expect(parsed2!.event.original_text).toBeUndefined()
    expect('original_text' in parsed2!.event).toBe(false)

    const parsed3 = parseSpeakIntentMessage({
      kind: 'speak-intent',
      text: '你好',
      original_text: 123
    })
    expect(parsed3).not.toBeNull()
    expect(parsed3!.event.original_text).toBeUndefined()
    expect('original_text' in parsed3!.event).toBe(false)
  })

  it('omits original_text when empty or only whitespace', () => {
    const parsed1 = parseSpeakIntentMessage({
      kind: 'speak-intent',
      text: '你好',
      original_text: ''
    })
    expect(parsed1).not.toBeNull()
    expect(parsed1!.event.original_text).toBeUndefined()
    expect('original_text' in parsed1!.event).toBe(false)

    const parsed2 = parseSpeakIntentMessage({
      kind: 'speak-intent',
      text: '你好',
      original_text: '    '
    })
    expect(parsed2).not.toBeNull()
    expect(parsed2!.event.original_text).toBeUndefined()
    expect('original_text' in parsed2!.event).toBe(false)
  })

  it('accepts original_text up to 240 unicode characters', () => {
    const text240 = 'A'.repeat(240)
    const parsed = parseSpeakIntentMessage({
      kind: 'speak-intent',
      text: '你好',
      original_text: text240
    })
    expect(parsed).not.toBeNull()
    expect(parsed!.event.original_text).toBe(text240)
  })

  it('counts unicode characters correctly (e.g. emojis/multibyte) for 240 char cap', () => {
    // 240 emoji characters (Array.from length 240)
    const emoji240 = '🐱'.repeat(240)
    const parsed = parseSpeakIntentMessage({
      kind: 'speak-intent',
      text: '你好',
      original_text: emoji240
    })
    expect(parsed).not.toBeNull()
    expect(parsed!.event.original_text).toBe(emoji240)
  })

  it('drops original_text if over 240 unicode characters, keeping the event valid', () => {
    const text241 = 'A'.repeat(241)
    const parsed = parseSpeakIntentMessage({
      kind: 'speak-intent',
      text: '你好',
      original_text: text241
    })
    expect(parsed).not.toBeNull()
    expect(parsed!.event.original_text).toBeUndefined()
    expect('original_text' in parsed!.event).toBe(false)

    const emoji241 = '🐱'.repeat(241)
    const parsedEmoji = parseSpeakIntentMessage({
      kind: 'speak-intent',
      text: '你好',
      original_text: emoji241
    })
    expect(parsedEmoji).not.toBeNull()
    expect(parsedEmoji!.event.original_text).toBeUndefined()
    expect('original_text' in parsedEmoji!.event).toBe(false)
  })
})
