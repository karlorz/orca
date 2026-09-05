import { describe, expect, it } from 'vitest'
import { parseSpeakIntentMessage } from './pet-speak-intent'

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
