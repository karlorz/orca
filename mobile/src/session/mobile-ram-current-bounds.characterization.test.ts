import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { TERMINAL_WRITE_MAX_PENDING_UNITS } from '../terminal/terminal-write-coalescer'

describe('mobile RAM current bounds characterization', () => {
  it('pins terminal write max pending units to 512 KiB UTF-16 units', () => {
    expect(TERMINAL_WRITE_MAX_PENDING_UNITS).toBe(512 * 1024)
  })

  it('pins mobile native chat session MAX_MESSAGES binding in source to 2000', () => {
    const sessionSourcePath = fileURLToPath(
      new URL('./use-mobile-native-chat-session.ts', import.meta.url)
    )
    const sessionSource = readFileSync(sessionSourcePath, 'utf8')
    expect(sessionSource).toMatch(/\bconst\s+MAX_MESSAGES\s*=\s*2000\b/)
  })

  it('pins terminal webview html scrollback to 5000', () => {
    const terminalHtmlSourcePath = fileURLToPath(
      new URL('../terminal/terminal-webview-html/terminal-init-and-write.ts', import.meta.url)
    )
    const terminalHtmlSource = readFileSync(terminalHtmlSourcePath, 'utf8')
    expect(terminalHtmlSource).toMatch(/\bscrollback:\s*5000\b/)
  })
})
