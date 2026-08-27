import { join } from 'node:path'
import { getLogsDirectory } from '../observability/logs-directory'
import { createLocalFileSink, type LocalFileSink } from '../observability/local-file-sink'
import type { AudioSessionState, PetSpeakOutcome } from './pet-voice-relay'

export type PetVoiceLogEvent =
  | {
      kind: 'subscriber-connect'
      socketPath: string
      timestamp: number
    }
  | {
      kind: 'subscriber-disconnect'
      reason?: string
      timestamp: number
    }
  | {
      kind: 'reconnect-delay'
      delayMs: number
      timestamp: number
    }
  | {
      kind: 'speak-intent'
      event_id?: string
      charsCount: number
      rate: number
      timestamp: number
    }
  | {
      kind: 'presence-change'
      state: AudioSessionState
      activeCount: number
      reporter?: string
      timestamp: number
    }
  | {
      kind: 'speak-complete'
      event_id: string
      outcome: PetSpeakOutcome
      timestamp: number
    }
  | {
      kind: 'emit-error'
      event_id?: string
      error: string
      timestamp: number
    }

export type PetVoiceLoggerOptions = {
  filePath?: string
  maxBytes?: number
  maxFiles?: number
  batchWindowMs?: number
}

export function defaultPetVoiceLogPath(): string {
  return join(getLogsDirectory(), 'pet-voice.ndjson')
}

export class PetVoiceLogger {
  private readonly sink: LocalFileSink

  constructor(options: PetVoiceLoggerOptions = {}) {
    const filePath = options.filePath ?? defaultPetVoiceLogPath()
    this.sink = createLocalFileSink({
      filePath,
      maxBytes: options.maxBytes ?? 1024 * 1024, // ~1 MB
      maxFiles: options.maxFiles ?? 2, // 2 files
      batchWindowMs: options.batchWindowMs
    })
  }

  logSubscriberConnect(data: { socketPath: string }): void {
    this.sink.push({
      kind: 'subscriber-connect',
      ...data,
      timestamp: Date.now()
    })
  }

  logSubscriberDisconnect(data: { reason?: string }): void {
    this.sink.push({
      kind: 'subscriber-disconnect',
      ...data,
      timestamp: Date.now()
    })
  }

  logReconnectDelay(data: { delayMs: number }): void {
    this.sink.push({
      kind: 'reconnect-delay',
      ...data,
      timestamp: Date.now()
    })
  }

  logSpeakIntent(data: { event_id?: string; charsCount: number; rate: number }): void {
    this.sink.push({
      kind: 'speak-intent',
      ...data,
      timestamp: Date.now()
    })
  }

  logPresenceChange(data: { state: AudioSessionState; activeCount: number; reporter?: string }): void {
    this.sink.push({
      kind: 'presence-change',
      ...data,
      timestamp: Date.now()
    })
  }

  logSpeakComplete(data: { event_id: string; outcome: PetSpeakOutcome }): void {
    this.sink.push({
      kind: 'speak-complete',
      ...data,
      timestamp: Date.now()
    })
  }

  logEmitError(data: { event_id?: string; error: string }): void {
    this.sink.push({
      kind: 'emit-error',
      ...data,
      timestamp: Date.now()
    })
  }

  flush(): void {
    this.sink.flush()
  }

  close(): void {
    this.sink.close()
  }
}
