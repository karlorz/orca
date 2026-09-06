import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  computeMobileLivePtyPayload,
  computeMobileLiveComposerValue,
  resolveMobileLiveSpoken,
  enqueueMobilePtySend
} from './mobile-dictation-live-apply'

describe('mobile-dictation-live-apply', () => {
  describe('resolveMobileLiveSpoken', () => {
    it('joins committed and partial segments', () => {
      expect(
        resolveMobileLiveSpoken({
          committedText: '今日',
          partialText: '天氣好',
          previousSpoken: ''
        })
      ).toBe('今日天氣好')
    })

    it('ignores empty next spoken when previous spoken is non-empty', () => {
      expect(
        resolveMobileLiveSpoken({
          committedText: '',
          partialText: '',
          previousSpoken: '今日天氣好'
        })
      ).toBe('今日天氣好')
      expect(
        resolveMobileLiveSpoken({
          committedText: '   ',
          partialText: '',
          previousSpoken: '今日天氣好'
        })
      ).toBe('今日天氣好')
    })

    it('returns empty string when both segments are empty and previous is empty', () => {
      expect(
        resolveMobileLiveSpoken({ committedText: '', partialText: '', previousSpoken: '' })
      ).toBe('')
    })
  })

  describe('computeMobileLivePtyPayload', () => {
    it('computes live PTY payload from delta on first insert', () => {
      const result = computeMobileLivePtyPayload({
        previousSpoken: '',
        nextSpoken: '你好'
      })
      expect(result).toEqual({
        deleteGraphemes: 0,
        insertText: '你好',
        payload: '你好',
        spoken: '你好'
      })
    })

    it('computes live PTY delta with backspaces when suffix changes (keepLength > 0)', () => {
      const result = computeMobileLivePtyPayload({
        previousSpoken: '你好嗎',
        nextSpoken: '你好呀'
      })
      expect(result).toEqual({
        deleteGraphemes: 1,
        insertText: '呀',
        payload: '\x7f呀',
        spoken: '你好呀'
      })
    })

    it('skips full-rewrite delete when keepLength is 0 and previous is non-empty without buffer cap', () => {
      // Complete rewrite from "你好" to "世界": keepLength is 0.
      // Without terminal buffer to cap backspaces, emitting \x7f\x7f might overshoot prompt/prefix.
      // Must return skip (payload null) and not update spoken.
      const result = computeMobileLivePtyPayload({
        previousSpoken: '你好',
        nextSpoken: '世界'
      })
      expect(result).toEqual({
        deleteGraphemes: 0,
        insertText: '',
        payload: null,
        spoken: '你好' // keeps previous spoken
      })
    })

    it('applies a full rewrite when applyFullRewrite is true so finals can land punctuation', () => {
      const result = computeMobileLivePtyPayload({
        previousSpoken: '你好',
        nextSpoken: '你好？',
        applyFullRewrite: true
      })
      expect(result.deleteGraphemes).toBeGreaterThanOrEqual(0)
      expect(result.payload).toBeTruthy()
      expect(result.spoken).toBe('你好？')
    })

    it('returns null payload when spoken does not change', () => {
      const result = computeMobileLivePtyPayload({
        previousSpoken: '你好',
        nextSpoken: '你好'
      })
      expect(result).toEqual({
        deleteGraphemes: 0,
        insertText: '',
        payload: null,
        spoken: '你好'
      })
    })
  })

  describe('computeMobileLiveComposerValue', () => {
    it('appends spoken to baseline for native chat / buffered composer', () => {
      const value = computeMobileLiveComposerValue({
        baseline: 'prefix: ',
        spoken: '你好'
      })
      expect(value).toBe('prefix: 你好')
    })
  })

  describe('enqueueMobilePtySend', () => {
    it('serializes overlapping PTY send tasks per key', async () => {
      const log: string[] = []
      const task1 = () =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            log.push('first')
            resolve()
          }, 30)
        })
      const task2 = () =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            log.push('second')
            resolve()
          }, 10)
        })

      enqueueMobilePtySend('handle-1', task1)
      enqueueMobilePtySend('handle-1', task2)

      await new Promise((resolve) => setTimeout(resolve, 80))
      expect(log).toEqual(['first', 'second'])
    })
  })

  it('wires live snapshot/finish helpers and resets the live session on start and cancel', () => {
    const source = readFileSync(
      new URL('./use-mobile-session-native-chat-dictation.ts', import.meta.url),
      'utf8'
    )
    expect(source).toContain('applyMobileLiveSnapshot({')
    expect(source).toContain('applyMobileLiveFinish({')
    expect(source).toContain('resetMobileLiveSession(liveSessionRef)')
  })
})
