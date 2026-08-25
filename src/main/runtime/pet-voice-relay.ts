import { type Socket, connect as netConnect } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export type AudioSessionState = 'live' | 'dead'

export type PetSpeakOutcome = 'spoken' | 'voice-unavailable' | 'playback-error' | 'cancelled'

export type PetSpeakEvent = {
  type: 'pet.speak'
  text: string
  lang?: string
  event_id?: string
}

export type PetVoiceRelayOptions = {
  petSocketPath?: string
  connectFn?: (path: string, onConnect?: () => void) => Socket
  reconnectBaseDelayMs?: number
  reconnectMaxDelayMs?: number
  onSpeak?: (event: PetSpeakEvent) => void
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
  private readonly listeners = new Set<(event: PetSpeakEvent) => void>()

  private audioSessionState: AudioSessionState = 'dead'
  private subscriberSocket: Socket | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private currentReconnectDelayMs: number
  private destroyed = false
  private readBuffer = ''

  constructor(options: PetVoiceRelayOptions = {}) {
    this.petSocketPath = options.petSocketPath ?? defaultPetSocketPath()
    this.connectFn = options.connectFn ?? ((path, onConnect) => netConnect(path, onConnect))
    this.reconnectBaseDelayMs = options.reconnectBaseDelayMs ?? DEFAULT_RECONNECT_BASE_DELAY_MS
    this.reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? DEFAULT_RECONNECT_MAX_DELAY_MS
    this.currentReconnectDelayMs = this.reconnectBaseDelayMs

    if (options.onSpeak) {
      this.listeners.add(options.onSpeak)
    }

    this.startSubscriber()
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
    // Always push. A failed unix write used to stick pet on the opposite
    // session while we no-op'd later same-state reports.
    await this.sendConfigPresence(newState)
  }

  private async sendConfigPresence(state: AudioSessionState): Promise<void> {
    await this.sendOneShotMessage({
      kind: 'config',
      audio_session: state,
      speak: false
    })
  }

  private async sendOneShotMessage(message: Record<string, unknown>): Promise<void> {
    if (this.destroyed) {
      return
    }
    const payload = `${JSON.stringify(message)}\n`

    await new Promise<void>((resolve) => {
      let settled = false
      const finish = (): void => {
        if (!settled) {
          settled = true
          resolve()
        }
      }

      let sock: Socket | undefined
      let wrote = false
      const writePayload = (): void => {
        if (wrote || this.destroyed || !sock) {
          return
        }
        const activeSock = sock
        wrote = true
        try {
          activeSock.write(payload, (err) => {
            if (err) {
              activeSock.destroy()
            } else {
              activeSock.end()
            }
            finish()
          })
        } catch {
          activeSock.destroy()
          finish()
        }
      }

      try {
        sock = this.connectFn(this.petSocketPath, writePayload)
      } catch {
        finish()
        return
      }

      sock.once('connect', writePayload)
      sock.once('error', () => {
        sock.destroy()
        finish()
      })
      const timeout = setTimeout(() => {
        sock.destroy()
        finish()
      }, 1500)
      timeout.unref?.()

      if (!sock.connecting && sock.writable) {
        writePayload()
      }
    })
  }

  private startSubscriber(): void {
    if (this.destroyed || this.subscriberSocket) {
      return
    }

    this.readBuffer = ''
    try {
      const onConnect = (): void => {
        this.currentReconnectDelayMs = this.reconnectBaseDelayMs
        try {
          const subscribePayload = `${JSON.stringify({
            kind: 'subscribe',
            channel: 'speak-intent',
            speak: false
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

      const cleanupAndReconnect = (): void => {
        if (this.subscriberSocket !== sock) {
          return
        }
        this.subscriberSocket = null
        sock.destroy()
        this.scheduleReconnect()
      }

      sock.on('error', cleanupAndReconnect)
      sock.on('end', cleanupAndReconnect)
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
          this.handleSpeakIntent(message)
        }
      } catch {
        // Ignore unparseable JSON lines
      }
    }
  }

  private handleSpeakIntent(message: Record<string, unknown>): void {
    if (this.audioSessionState !== 'live') {
      return
    }

    const rawText = typeof message.text === 'string' ? message.text.trim() : ''
    // Trust boundary: non-empty trimmed text up to 70 Unicode characters
    const textChars = Array.from(rawText)
    if (textChars.length === 0 || textChars.length > 70) {
      return
    }

    // Language trust boundary: limited to Cantonese forms
    const rawLang = typeof message.lang === 'string' ? message.lang.trim().toLowerCase() : ''
    const allowedLangs = new Set(['yue', 'cantonese', 'yue-hk', 'zh-hk'])
    if (rawLang && !allowedLangs.has(rawLang)) {
      return
    }

    // Event ID correlation & validation: non-empty <= 128 Unicode characters
    let eventId = typeof message.event_id === 'string' ? message.event_id.trim() : ''
    if (eventId) {
      if (Array.from(eventId).length > 128) {
        return
      }
    } else {
      // Compatibility correlation ID if missing
      eventId = `relay-${randomUUID()}`
    }

    const event: PetSpeakEvent = {
      type: 'pet.speak',
      text: rawText,
      lang:
        typeof message.lang === 'string' && message.lang.trim().length > 0
          ? message.lang.trim()
          : undefined,
      event_id: eventId
    }

    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch (err) {
        console.error('[pet-voice-relay] Listener error:', err)
      }
    }
  }

  async sendSpeakComplete(eventId: string, outcome: PetSpeakOutcome): Promise<void> {
    await this.sendOneShotMessage({
      kind: 'speak-complete',
      event_id: eventId,
      outcome,
      speak: false
    })
  }

  private scheduleReconnect(): void {
    if (this.destroyed || this.reconnectTimer) {
      return
    }

    const delay = this.currentReconnectDelayMs
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
  }
}
