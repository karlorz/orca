import { describe, expect, it, vi } from 'vitest'
import {
  claimTerminalRightClickPasteMouseDown,
  isTerminalRightClickPasteGesture
} from './terminal-right-click-paste-gesture'

describe('isTerminalRightClickPasteGesture', () => {
  const rightPress = { button: 2, ctrlKey: false }

  it('claims an ordinary right-press when paste is on and mouse tracking is off', () => {
    expect(isTerminalRightClickPasteGesture(rightPress, true)).toBe(true)
    expect(isTerminalRightClickPasteGesture(rightPress, true, 'none')).toBe(true)
    expect(isTerminalRightClickPasteGesture(rightPress, true, undefined)).toBe(true)
  })

  it('yields to active mouse tracking so the TUI still receives PTY mouse reports', () => {
    for (const mode of ['x10', 'vt200', 'drag', 'any'] as const) {
      expect(isTerminalRightClickPasteGesture(rightPress, true, mode)).toBe(false)
    }
  })

  it('does not claim Ctrl+right-click or a disabled paste setting', () => {
    expect(isTerminalRightClickPasteGesture({ button: 2, ctrlKey: true }, true, 'none')).toBe(false)
    expect(isTerminalRightClickPasteGesture(rightPress, false, 'none')).toBe(false)
    expect(isTerminalRightClickPasteGesture({ button: 0, ctrlKey: false }, true, 'none')).toBe(
      false
    )
  })
})

describe('claimTerminalRightClickPasteMouseDown', () => {
  it('stops the press before xterm and focuses the terminal', () => {
    const preventDefault = vi.fn()
    const stopPropagation = vi.fn()
    const focus = vi.fn()
    claimTerminalRightClickPasteMouseDown(
      { button: 2, ctrlKey: false, preventDefault, stopPropagation },
      { focus }
    )
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(stopPropagation).toHaveBeenCalledOnce()
    expect(focus).toHaveBeenCalledOnce()
  })
})
