import { describe, expect, it, vi } from 'vitest'
import { PetVoiceLogger, type PetVoiceLogEvent } from './pet-voice-logger'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('PetVoiceLogger', () => {
  it('writes ndjson events to the injected log file path and rotates at maxBytes keeping maxFiles', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pet-voice-logger-'))
    const logPath = join(dir, 'pet-voice.ndjson')

    try {
      const logger = new PetVoiceLogger({
        filePath: logPath,
        maxBytes: 100_000,
        maxFiles: 2,
        batchWindowMs: 0 // Immediate flush
      })

      logger.logSubscriberConnect({ socketPath: '/tmp/pet.sock' })
      logger.logSpeakIntent({ event_id: 'ev-1', charsCount: 10, rate: 1.2 })
      logger.logPresenceChange({ state: 'live', activeCount: 1, reporter: 'orca-1234' })
      logger.logSpeakComplete({ event_id: 'ev-1', outcome: 'spoken' })
      logger.logEmitError({ event_id: 'ev-2', error: 'connection closed' })
      logger.logReconnectDelay({ delayMs: 1000 })
      logger.logSubscriberDisconnect({ reason: 'socket end' })

      logger.flush()

      const content = readFileSync(logPath, 'utf8')
      const lines = content.trim().split('\n').map((l) => JSON.parse(l) as PetVoiceLogEvent)
      expect(lines.length).toBe(7)
      expect(lines[0]?.kind).toBe('subscriber-connect')
      expect(lines[1]?.kind).toBe('speak-intent')
      expect(lines[2]?.kind).toBe('presence-change')
      expect((lines[2] as { reporter?: string })?.reporter).toBe('orca-1234')
      expect(lines[3]?.kind).toBe('speak-complete')
      expect(lines[4]?.kind).toBe('emit-error')
      expect(lines[5]?.kind).toBe('reconnect-delay')
      expect(lines[6]?.kind).toBe('subscriber-disconnect')

      logger.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rotates files when exceeding maxBytes and keeps 2 files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pet-voice-logger-rot-'))
    const logPath = join(dir, 'pet-voice.ndjson')

    try {
      const logger = new PetVoiceLogger({
        filePath: logPath,
        maxBytes: 250, // Small maxBytes to trigger rotation
        maxFiles: 2,
        batchWindowMs: 0
      })

      for (let i = 0; i < 10; i++) {
        logger.logSpeakIntent({ event_id: `ev-${i}`, charsCount: 20, rate: 1.2 })
      }
      logger.flush()

      expect(existsSync(logPath)).toBe(true)
      expect(existsSync(`${logPath}.1`)).toBe(true)
      // Max 2 files means `.2` should not exist
      expect(existsSync(`${logPath}.2`)).toBe(false)

      logger.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
