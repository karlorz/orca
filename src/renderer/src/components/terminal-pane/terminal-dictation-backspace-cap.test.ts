import { describe, expect, it } from 'vitest'
import {
  capDictationBackspaces,
  type TerminalBufferForDictationCap
} from './terminal-dictation-backspace-cap'

type MockLine = {
  isWrapped: boolean
  text: string
}

function createMockBuffer(
  lines: MockLine[],
  cursorX: number,
  cursorY: number,
  baseY = 0
): TerminalBufferForDictationCap {
  return {
    cursorX,
    cursorY,
    baseY,
    getLine: (y: number) => {
      const line = lines[y]
      if (!line) {
        return undefined
      }
      return {
        isWrapped: line.isWrapped,
        translateToString: (trimRight?: boolean, startCol = 0, endCol = line.text.length) => {
          const slice = line.text.slice(startCol, endCol)
          return trimRight ? slice.trimEnd() : slice
        }
      }
    }
  }
}

describe('capDictationBackspaces', () => {
  it('caps at live graphemes on one line when keepLength is 0 so prefix is not deleted', () => {
    // Prompt/prefix: "prompt $ ", typed/live: "你好"
    // Total behind cursor: "prompt $ 你好" (cursorX = 11, cursorY = 0)
    // liveSegment = "你好" (2 graphemes)
    // requestedBackspaces = 2
    const buffer = createMockBuffer([{ isWrapped: false, text: 'prompt $ 你好' }], 11, 0)
    const capped = capDictationBackspaces({
      buffer,
      requestedBackspaces: 2,
      liveSegment: '你好'
    })
    expect(capped).toBe(2)

    // If requestedBackspaces is excessively large (e.g. 10), cap must not exceed matching suffix graphemes (2)
    const cappedOvershoot = capDictationBackspaces({
      buffer,
      requestedBackspaces: 10,
      liveSegment: '你好'
    })
    expect(cappedOvershoot).toBe(2)
  })

  it('preserves prefix on row 0 across hard wrap when live tail is on row 1 (isWrapped=false)', () => {
    // Row 0: "prompt $ 前綴", isWrapped: false (hard wrap / newline / TUI re-render)
    // Row 1: "尾巴", isWrapped: false, cursor at x=2, y=1
    // liveSegment: "前綴尾巴" (4 graphemes), requestedBackspaces: 4
    // Because row 1 isWrapped=false, buffer walk must NOT climb onto row 0.
    // Behind cursor on row 1: "尾巴"
    // Longest suffix of liveSegment "前綴尾巴" matching suffix of "尾巴" is "尾巴" (2 graphemes).
    // Cap must equal 2, preserving row 0 prefix.
    const buffer = createMockBuffer(
      [
        { isWrapped: false, text: 'prompt $ 前綴' },
        { isWrapped: false, text: '尾巴' }
      ],
      2,
      1
    )
    const capped = capDictationBackspaces({
      buffer,
      requestedBackspaces: 4,
      liveSegment: '前綴尾巴'
    })
    expect(capped).toBe(2)
  })

  it('allows full liveSegment graphemes across soft wrap (row 1 isWrapped=true)', () => {
    // Row 0: "prompt $ 今日", isWrapped: false
    // Row 1: "天氣好", isWrapped: true, cursor at x=3, y=1
    // liveSegment: "今日天氣好" (5 graphemes), requestedBackspaces: 5
    // Row 1 is wrapped, so walk backward includes row 0.
    // Behind cursor text: "prompt $ 今日天氣好"
    // Longest suffix matching liveSegment is "今日天氣好" (5 graphemes).
    // Cap must equal 5 (full live graphemes). Prefix "prompt $ " is not deleted.
    const buffer = createMockBuffer(
      [
        { isWrapped: false, text: 'prompt $ 今日' },
        { isWrapped: true, text: '天氣好' }
      ],
      3,
      1
    )
    const capped = capDictationBackspaces({
      buffer,
      requestedBackspaces: 5,
      liveSegment: '今日天氣好'
    })
    expect(capped).toBe(5)

    // Even if requestedBackspaces is 20, prefix "prompt $ " must not be backspaced:
    const cappedOvershoot = capDictationBackspaces({
      buffer,
      requestedBackspaces: 20,
      liveSegment: '今日天氣好'
    })
    expect(cappedOvershoot).toBe(5)
  })

  it('returns 0 when liveSegment is empty or requestedBackspaces is 0', () => {
    const buffer = createMockBuffer([{ isWrapped: false, text: 'prompt $ ' }], 9, 0)
    expect(
      capDictationBackspaces({
        buffer,
        requestedBackspaces: 5,
        liveSegment: ''
      })
    ).toBe(0)

    expect(
      capDictationBackspaces({
        buffer,
        requestedBackspaces: 0,
        liveSegment: '你好'
      })
    ).toBe(0)
  })

  it('returns requestedBackspaces unchanged when buffer is null or undefined', () => {
    expect(
      capDictationBackspaces({
        buffer: undefined,
        requestedBackspaces: 5,
        liveSegment: '你好'
      })
    ).toBe(5)
  })

  it('reads the cursor line at baseY + cursorY so scrollback cannot uncap prefix deletes', () => {
    // Viewport starts at buffer line 2. cursorY is viewport-relative (xterm).
    // Line 0 would be stale scrollback; the live row is at absolute index 2.
    const buffer = createMockBuffer(
      [
        { isWrapped: false, text: 'old output 一二三四五六七八九十' },
        { isWrapped: false, text: 'more scrollback' },
        { isWrapped: false, text: 'prompt $ 你好' }
      ],
      11,
      0,
      2
    )
    expect(
      capDictationBackspaces({
        buffer,
        requestedBackspaces: 10,
        liveSegment: '你好'
      })
    ).toBe(2)
  })
})
