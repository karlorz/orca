import { type Socket, connect as netConnect } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { PetVoiceLogger } from './pet-voice-logger'
import { buildDeviceStatusMessage } from './pet-speak-rate'
import type { PetSpeakEvent } from './pet-speak-intent'
import { dispatchPetVoiceSpeakIntent } from './pet-voice-relay-intent'
import {
  type PetSpeakBoundaryTimestamps,
  type PetSpeakCancelReason,
  stampBoundary
} from './pet-speak-observability'
import {
  readPetVoiceAcceptanceReceipt,
  writePetVoiceOneShotMessage,
  type PetVoiceOneShotHost
} from './pet-voice-relay-oneshot'

export type AudioSessionState = 'live' | 'dead'
export {
  parsePetSpeakRate,
  PET_SPEAK_DEFAULT_RATE,
  PET_SPEAK_MIN_RATE,
  PET_SPEAK_MAX_RATE
} from './pet-speak-rate'

export type PetSpeakOutcome = 'spoken' | 'voice-unavailable' | 'playback-error' | 'cancelled'

export type { PetSpeakEvent } from './pet-speak-intent'

export type PetVoiceRelayOptions = {
  petSocketPath?: string
  connectFn?: (path: string, onConnect?: () => void) => Socket
  reconnectBaseDelayMs?: number
  reconnectMaxDelayMs?: number
  acceptanceDeadlineMs?: number
  onSpeak?: (event: PetSpeakEvent) => void
  logger?: PetVoiceLogger
  reporterId?: string
}

const DEFAULT_RECONNECT_BASE_DELAY_MS = 1000
const DEFAULT_RECONNECT_MAX_DELAY_MS = 10000

export function defaultPetSocketPath(): string {
  const customPrefix = process.env.GROKPET_PREFIX?.trim()
  if (customPrefix) {
    return join(customPrefix, 'pet.sock')
  }
  return join(homedir(), '.grok', 'desktop-pet', 'pet.sock')
}

export class PetVoiceRelay {
  private readonly petSocketPath: string
  private readonly connectFn: (path: string, onConnect?: () => void) => Socket
  private readonly reconnectBaseDelayMs: number
  private readonly reconnectMaxDelayMs: number
  private readonly acceptanceDeadlineMs: number
  private readonly listeners = new Set<(event: PetSpeakEvent) => void>()
  private readonly logger: PetVoiceLogger
  private readonly reporterId: string

  private audioSessionState: AudioSessionState = 'dead'
  private subscriberSocket: Socket | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private currentReconnectDelayMs: number
  private oneShotTail: Promise<void> = Promise.resolve()
  private destroyed = false
  private readBuffer = ''

  constructor(options: PetVoiceRelayOptions = {}) {
    this.petSocketPath = options.petSocketPath ?? defaultPetSocketPath()
    this.connectFn = options.connectFn ?? ((path, onConnect) => netConnect(path, onConnect))
    this.reconnectBaseDelayMs = options.reconnectBaseDelayMs ?? DEFAULT_RECONNECT_BASE_DELAY_MS
    this.reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? DEFAULT_RECONNECT_MAX_DELAY_MS
    this.acceptanceDeadlineMs = options.acceptanceDeadlineMs ?? 1500
    this.currentReconnectDelayMs = this.reconnectBaseDelayMs
    this.logger = options.logger ?? new PetVoiceLogger()
    this.reporterId = options.reporterId ?? `orca-${process.pid}`

    if (options.onSpeak) {
      this.listeners.add(options.onSpeak)
    }

    this.startSubscriber()
  }

  getReporterId(): string {
    return this.reporterId
  }

  getLogger(): PetVoiceLogger {
    return this.logger
  }

  getAudioSessionState(): AudioSessionState {
    return this.audioSessionState
  }

  onSpeak(listener: (event: PetSpeakEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async onVoiceSubscriptionPresenceChange(activeSubscriptionCount: number): Promise<void> {
    if (this.destroyed) {
      return
    }
    const newState: AudioSessionState = activeSubscriptionCount > 0 ? 'live' : 'dead'
    this.audioSessionState = newState
    this.logger.logPresenceChange({
      state: newState,
      activeCount: activeSubscriptionCount,
      reporter: this.reporterId
    })
    // Always push so a failed unix write cannot stick the opposite session.
    await this.sendConfigPresence(newState)
  }

  private async sendConfigPresence(state: AudioSessionState): Promise<void> {
    await this.sendOneShotMessage({
      kind: 'config',
      audio_session: state,
      speak: false,
      reporter: this.reporterId
    })
  }

  private async sendOneShotMessage(message: Record<string, unknown>): Promise<void> {
    const queued = this.oneShotTail.then(() =>
      writePetVoiceOneShotMessage(this.oneshotHost(), message)
    )
    this.oneShotTail = queued.catch(() => {})
    await queued
  }

  private oneshotHost(): PetVoiceOneShotHost {
    return {
      isDestroyed: () => this.destroyed,
      connectFn: this.connectFn,
      petSocketPath: this.petSocketPath,
      logger: this.logger
    }
  }

  private startSubscriber(): void {
    if (this.destroyed || this.subscriberSocket) {
      return
    }

    this.readBuffer = ''
    try {
      const onConnect = (): void => {
        this.currentReconnectDelayMs = this.reconnectBaseDelayMs
        this.logger.logSubscriberConnect({ socketPath: this.petSocketPath })
        try {
          const subscribePayload = `${JSON.stringify({
            kind: 'subscribe',
            channel: 'speak-intent',
            speak: false,
            reporter: this.reporterId
          })}\n`
          sock.write(subscribePayload)
        } catch {
          // Socket write failed, error handler will reconnect
        }
        if (this.audioSessionState === 'live') {
          void this.sendConfigPresence('live')
        }
      }

      const sock = this.connectFn(this.petSocketPath, onConnect)
      this.subscriberSocket = sock

      sock.once('connect', onConnect)

      sock.on('data', (chunk) => {
        this.handleSubscriberData(chunk)
      })

      const cleanupAndReconnect = (reason?: string): void => {
        if (this.subscriberSocket !== sock) {
          return
        }
        this.logger.logSubscriberDisconnect({ reason })
        this.subscriberSocket = null
        sock.destroy()
        this.scheduleReconnect()
      }

      sock.on('error', (err) => cleanupAndReconnect(err ? String(err) : 'error'))
      sock.on('end', () => cleanupAndReconnect('end'))
    } catch {
      this.scheduleReconnect()
    }
  }

  private handleSubscriberData(chunk: Buffer | string): void {
    this.readBuffer += chunk.toString('utf8')
    const lines = this.readBuffer.split('\n')
    this.readBuffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) {
        continue
      }
      try {
        const message = JSON.parse(trimmed) as Record<string, unknown>
        if (message.kind === 'speak-intent') {
          dispatchPetVoiceSpeakIntent(message, this.audioSessionState, this.listeners, this.logger)
        }
      } catch {
        // Ignore unparseable JSON lines
      }
    }
  }

  async sendSpeakComplete(
    eventId: string,
    outcome: PetSpeakOutcome,
    reason?: PetSpeakCancelReason
  ): Promise<void> {
    this.logger.logSpeakComplete({ event_id: eventId, outcome, reason })
    await this.sendOneShotMessage({
      kind: 'speak-complete',
      event_id: eventId,
      outcome,
      ...(reason ? { reason } : {}),
      speak: false
    })
  }

  async sendSpeakAccepted(
    eventId: string
  ): Promise<{ accepted: boolean; reason?: PetSpeakCancelReason }> {
    const timestamps: PetSpeakBoundaryTimestamps = {}
    stampBoundary(timestamps, 'relay_enqueue')
    this.logger.logBoundary({
      event_id: eventId,
      boundary: 'relay_enqueue',
      timestamp: timestamps.relay_enqueue,
      timestamps
    })
    const enqueuedAt = timestamps.relay_enqueue ?? Date.now()
    const queued = this.oneShotTail.then(async () => {
      const remainingMs = this.acceptanceDeadlineMs - (Date.now() - enqueuedAt)
      if (remainingMs <= 0) {
        stampBoundary(timestamps, 'relay_receipt')
        this.logger.logBoundary({
          event_id: eventId,
          boundary: 'relay_receipt',
          timestamp: timestamps.relay_receipt,
          accepted: false,
          reason: 'receipt_timeout',
          timestamps
        })
        return { accepted: false, reason: 'receipt_timeout' as const }
      }
      return await readPetVoiceAcceptanceReceipt(
        this.oneshotHost(),
        eventId,
        remainingMs,
        timestamps
      )
    })
    this.oneShotTail = queued.then(
      () => undefined,
      () => undefined
    )
    return await queued
  }

  async sendDeviceStatus(status: Record<string, unknown>, connectionId?: string): Promise<void> {
    await this.sendOneShotMessage(buildDeviceStatusMessage(status, this.reporterId, connectionId))
  }

  private scheduleReconnect(): void {
    if (this.destroyed || this.reconnectTimer) {
      return
    }

    const delay = this.currentReconnectDelayMs
    this.logger.logReconnectDelay({ delayMs: delay })
    this.currentReconnectDelayMs = Math.min(
      this.currentReconnectDelayMs * 2,
      this.reconnectMaxDelayMs
    )

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.startSubscriber()
    }, delay)
    this.reconnectTimer.unref?.()
  }

  destroy(): void {
    this.destroyed = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.subscriberSocket) {
      const sock = this.subscriberSocket
      this.subscriberSocket = null
      sock.destroy()
    }
    this.listeners.clear()
    this.logger.close()
  }
}
