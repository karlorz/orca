import type { Socket } from 'node:net'
import type { PetVoiceLogger } from './pet-voice-logger'
import {
  stampBoundary,
  type PetSpeakBoundaryTimestamps,
  type PetSpeakCancelReason
} from './pet-speak-observability'

export type PetVoiceOneShotHost = {
  isDestroyed(): boolean
  connectFn: (path: string, onConnect?: () => void) => Socket
  petSocketPath: string
  logger: PetVoiceLogger
}

export async function writePetVoiceOneShotMessage(
  host: PetVoiceOneShotHost,
  message: Record<string, unknown>
): Promise<void> {
  if (host.isDestroyed()) {
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
      if (wrote || host.isDestroyed() || !sock) {
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
      sock = host.connectFn(host.petSocketPath, writePayload)
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

export async function readPetVoiceAcceptanceReceipt(
  host: PetVoiceOneShotHost,
  eventId: string,
  remainingMs: number,
  timestamps: PetSpeakBoundaryTimestamps
): Promise<{ accepted: boolean; reason?: PetSpeakCancelReason }> {
  const payload = `${JSON.stringify({ kind: 'speak-accepted', event_id: eventId, speak: false })}\n`

  return await new Promise<{ accepted: boolean; reason?: PetSpeakCancelReason }>((resolve) => {
    let settled = false
    let buffer = ''
    let sock: Socket | undefined
    let wrote = false
    const timeout = setTimeout(() => finish(false, 'receipt_timeout'), remainingMs)
    timeout.unref?.()

    const finish = (accepted: boolean, reason?: PetSpeakCancelReason): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      stampBoundary(timestamps, 'relay_receipt')
      host.logger.logBoundary({
        event_id: eventId,
        boundary: 'relay_receipt',
        timestamp: timestamps.relay_receipt,
        accepted,
        reason,
        timestamps
      })
      sock?.destroy()
      resolve({ accepted, ...(reason ? { reason } : {}) })
    }
    const writePayload = (): void => {
      if (wrote || host.isDestroyed() || !sock) {
        return
      }
      wrote = true
      stampBoundary(timestamps, 'relay_write')
      host.logger.logBoundary({
        event_id: eventId,
        boundary: 'relay_write',
        timestamp: timestamps.relay_write,
        timestamps
      })
      try {
        sock.write(payload, (err) => {
          if (err) {
            finish(false, 'transport_teardown')
          }
        })
      } catch {
        finish(false, 'transport_teardown')
      }
    }

    try {
      sock = host.connectFn(host.petSocketPath, writePayload)
    } catch {
      finish(false, 'transport_teardown')
      return
    }
    sock.once('connect', writePayload)
    sock.once('error', () => finish(false, 'transport_teardown'))
    sock.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      const newline = buffer.indexOf('\n')
      if (newline === -1) {
        return
      }
      try {
        const receipt = JSON.parse(buffer.slice(0, newline).trim()) as Record<string, unknown>
        finish(receipt.ok === true && receipt.accepted === true && receipt.event_id === eventId)
      } catch {
        finish(false, 'transport_teardown')
      }
    })
    if (!sock.connecting && sock.writable) {
      writePayload()
    }
  })
}
