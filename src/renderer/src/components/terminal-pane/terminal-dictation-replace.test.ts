import { describe, expect, it, vi } from 'vitest'
import type { PaneManager } from '@/lib/pane-manager/pane-manager'
import type { PtyTransport } from './pty-transport'
import { handleDictationReplaceTextEvent } from './terminal-dictation-replace'

vi.mock('./terminal-programmatic-text-paste', () => ({
  handleTerminalProgrammaticTextPaste: vi.fn(async ({ detail }: { detail: { text?: string } }) => {
    // Why: production paste is async (plan, chunked writes, PTY backpressure).
    // A sync mock hid later backspaces overtaking an insert still in flight.
    await new Promise((resolve) => setTimeout(resolve, 25))
    writes.push(`insert:${detail.text ?? ''}`)
  })
}))

vi.mock('./terminal-pty-paste-writer', () => ({
  writeTerminalPastePtyInput: vi.fn(async (_transport: unknown, data: string) => {
    writes.push(`backspace:${data.length}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
    return true
  })
}))

const writes: string[] = []

describe('handleDictationReplaceTextEvent', () => {
  it('serializes overlapping live-insert replaces so a long wrapped line cannot be wiped by a later short partial', async () => {
    writes.length = 0
    const transport = {
      sendInput: vi.fn(),
      sendInputAccepted: vi.fn()
    } as unknown as PtyTransport
    const pane = {
      id: 1,
      leafId: 'leaf-1',
      terminal: { modes: {}, focus: vi.fn() }
    }
    const args = {
      tabId: 'tab-1',
      worktreeId: 'wt-1',
      getManager: () =>
        ({
          getPanes: () => [pane],
          getActivePane: () => pane
        }) as unknown as PaneManager,
      getPaneTransports: () => new Map([[1, transport]])
    }

    handleDictationReplaceTextEvent({
      ...args,
      detail: { tabId: 'tab-1', paneId: 1, backspaces: 3, text: '一二三四五六七八九十' }
    })
    handleDictationReplaceTextEvent({
      ...args,
      detail: { tabId: 'tab-1', paneId: 1, backspaces: 10, text: '短' }
    })

    await new Promise((resolve) => setTimeout(resolve, 150))

    expect(writes).toEqual([
      'backspace:3',
      'insert:一二三四五六七八九十',
      'backspace:10',
      'insert:短'
    ])
  })

  it('caps backspaces against mock buffer on active pane so prefix is preserved on keepLength-0 wrap', async () => {
    writes.length = 0
    const transport = {
      sendInput: vi.fn(),
      sendInputAccepted: vi.fn()
    } as unknown as PtyTransport
    // Buffer has row 0 "prefix prompt " (isWrapped=false)
    // and row 1 "尾巴" (isWrapped=false, hard wrap), cursor at x=2, y=1
    const buffer = {
      cursorX: 2,
      cursorY: 1,
      getLine: (y: number) => {
        if (y === 0) {
          return {
            isWrapped: false,
            translateToString: () => 'prefix prompt '
          }
        }
        if (y === 1) {
          return {
            isWrapped: false,
            translateToString: () => '尾巴'
          }
        }
        return undefined
      }
    }
    const pane = {
      id: 1,
      leafId: 'leaf-1',
      terminal: { modes: {}, focus: vi.fn(), buffer: { active: buffer } }
    }
    const args = {
      tabId: 'tab-1',
      worktreeId: 'wt-1',
      getManager: () =>
        ({
          getPanes: () => [pane],
          getActivePane: () => pane
        }) as unknown as PaneManager,
      getPaneTransports: () => new Map([[1, transport]])
    }

    // Detail requested 4 backspaces for liveSegment '前綴尾巴' (4 graphemes), but only 2 ('尾巴') are on current unwrapped line
    handleDictationReplaceTextEvent({
      ...args,
      detail: {
        tabId: 'tab-1',
        paneId: 1,
        backspaces: 4,
        liveSegment: '前綴尾巴',
        text: '新詞'
      }
    })

    await new Promise((resolve) => setTimeout(resolve, 100))

    // Backspaces must be capped at 2, not wiping prefix on row 0
    expect(writes).toEqual(['backspace:2', 'insert:新詞'])
  })
})
