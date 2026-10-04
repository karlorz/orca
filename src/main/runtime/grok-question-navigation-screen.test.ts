import { readFileSync } from 'node:fs'
import { Terminal } from '@xterm/headless'
import { describe, expect, it } from 'vitest'
import { verifyGrokQuestionNavigationScreen } from './grok-question-navigation-screen'

describe('Grok question keyboard ownership', () => {
  it('accepts the navigation screen rendered from a real Grok Build 1.0.45 capture', async () => {
    const terminal = new Terminal({ cols: 130, rows: 40, allowProposedApi: true })
    try {
      await new Promise<void>((resolve) =>
        terminal.write(
          readFileSync(
            new URL('./__fixtures__/grok-question-navigation.txt', import.meta.url),
            'utf8'
          ),
          resolve
        )
      )
      const buffer = terminal.buffer.active
      const lines = Array.from(
        { length: terminal.rows },
        (_, row) => buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? ''
      )
      expect(() => verifyGrokQuestionNavigationScreen(lines)).not.toThrow()
      expect(() =>
        verifyGrokQuestionNavigationScreen(lines, {
          question: 'Question navigation capture',
          optionLabels: ['Keep pending', 'Confirm capture']
        })
      ).not.toThrow()
      expect(() =>
        verifyGrokQuestionNavigationScreen(lines, {
          question: 'Some other live question',
          optionLabels: ['Keep pending']
        })
      ).toThrow('question_progress_unverifiable')
      expect(() =>
        verifyGrokQuestionNavigationScreen(
          lines.filter((line) => !line.includes('Tab:next answer'))
        )
      ).toThrow('question_keyboard_unverifiable')
      expect(() =>
        verifyGrokQuestionNavigationScreen(lines.filter((line) => !line.includes('↑/↓ navigate')))
      ).toThrow('question_keyboard_unverifiable')
    } finally {
      terminal.dispose()
    }
  })
  it('rejects an idle terminal', () => {
    expect(() => verifyGrokQuestionNavigationScreen(['❯', 'Ctrl+x:shortcuts'])).toThrow(
      'question_keyboard_unverifiable'
    )
  })
})
