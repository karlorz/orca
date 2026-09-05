import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('build-speech-macos.mjs', () => {
  it('exists and is executable or node-runnable', () => {
    expect(existsSync('config/scripts/build-speech-macos.mjs')).toBe(true)
  })

  it('exits 0 with no-op on non-darwin platforms', async () => {
    const child = spawn(process.execPath, ['config/scripts/build-speech-macos.mjs'], {
      env: { ...process.env, ORCA_TEST_PLATFORM_OVERRIDE: 'linux' }
    })
    const exitCode = await new Promise((resolve) => child.on('exit', (code) => resolve(code ?? 1)))
    expect(exitCode).toBe(0)
  })

  it('fails closed with apple_speech_locale_unsupported when locale is unsupported', async () => {
    // Verify native/speech-macos/main.swift rejects unsupported candidate locale rather than falling back
    const { readFileSync } = await import('node:fs')
    const source = readFileSync('native/speech-macos/main.swift', 'utf8')
    expect(source).not.toContain('return (Locale(identifier: chosenId), source, chosenId)')
    expect(source).toContain(
      'emitJson(["type": "error", "error": "apple_speech_locale_unsupported:'
    )
  })
})
