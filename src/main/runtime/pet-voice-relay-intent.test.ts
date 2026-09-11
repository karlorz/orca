import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PetVoiceLogger, type PetVoiceLogEvent } from './pet-voice-logger'
import { dispatchPetVoiceSpeakIntent } from './pet-voice-relay-intent'

function readLog(path: string): PetVoiceLogEvent[] {
  const content = readFileSync(path, 'utf8').trim()
  if (!content) {
    return []
  }
  return content.split('\n').map((line) => JSON.parse(line) as PetVoiceLogEvent)
}

describe('dispatchPetVoiceSpeakIntent', () => {
  it('logs speak-intent reject when text exceeds PET_SPEAK_MAX_TEXT_GRAPHEMES (reason: length)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-intent-test-'))
    const logPath = join(dir, 'pet-voice.ndjson')
    try {
      const logger = new PetVoiceLogger({ filePath: logPath, batchWindowMs: 0 })
      const listener = vi.fn()
      const longText = '粵'.repeat(2001)

      dispatchPetVoiceSpeakIntent(
        {
          kind: 'speak-intent',
          event_id: 'ev-too-long',
          text: longText
        },
        'live',
        [listener],
        logger
      )

      logger.flush()
      const lines = readLog(logPath)
      expect(listener).not.toHaveBeenCalled()

      const rejectLog = lines.find((row) => row.kind === 'speak-intent-reject')
      expect(rejectLog).toBeDefined()
      expect(rejectLog).toEqual(
        expect.objectContaining({
          kind: 'speak-intent-reject',
          event_id: 'ev-too-long',
          charsCount: 2001,
          reason: 'length'
        })
      )

      logger.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not log speak-intent reject for empty text rejects', () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-intent-empty-'))
    const logPath = join(dir, 'pet-voice.ndjson')
    try {
      const logger = new PetVoiceLogger({ filePath: logPath, batchWindowMs: 0 })
      const listener = vi.fn()

      dispatchPetVoiceSpeakIntent(
        {
          kind: 'speak-intent',
          event_id: 'ev-empty',
          text: '   '
        },
        'live',
        [listener],
        logger
      )

      logger.flush()
      const lines = readLog(logPath)
      expect(listener).not.toHaveBeenCalled()

      const rejectLogs = lines.filter((row) => row.kind === 'speak-intent-reject')
      expect(rejectLogs).toHaveLength(0)

      logger.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('dispatches valid 91-char ask and logs speak-intent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-intent-valid-'))
    const logPath = join(dir, 'pet-voice.ndjson')
    try {
      const logger = new PetVoiceLogger({ filePath: logPath, batchWindowMs: 0 })
      const listener = vi.fn()
      const text91 =
        "我哋點樣 reconcile '2026-08-10-grok-build-init-pvelxc-3adc3628' 喺 cmux (stale-or-superseded) 呀？"

      dispatchPetVoiceSpeakIntent(
        {
          kind: 'speak-intent',
          event_id: 'ev-valid-91',
          text: text91
        },
        'live',
        [listener],
        logger
      )

      logger.flush()
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'pet.speak',
          text: text91,
          event_id: 'ev-valid-91'
        })
      )

      const lines = readLog(logPath)
      const speakIntent = lines.find((row) => row.kind === 'speak-intent')
      expect(speakIntent).toEqual(
        expect.objectContaining({
          kind: 'speak-intent',
          event_id: 'ev-valid-91',
          charsCount: 91
        })
      )

      logger.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
