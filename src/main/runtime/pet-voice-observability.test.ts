import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Socket } from 'node:net'
import { ALL_RPC_METHODS } from './rpc/methods'
import type { RpcContext, RpcMethod } from './rpc/core'
import { PetVoiceLogger, type PetVoiceLogEvent } from './pet-voice-logger'
import { PetVoiceRelay, type PetVoiceRelayOptions } from './pet-voice-relay'
import type { OrcaRuntimeService } from './orca-runtime'
import { PET_SPEAK_CANCEL_REASONS } from './pet-speak-observability'

type MockPetSocket = EventEmitter & {
  write: ReturnType<typeof vi.fn>
  end: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
  connecting?: boolean
  writable?: boolean
}

function createMockPetSocket(onWrite?: (data: string) => void): MockPetSocket {
  const sock = new EventEmitter() as MockPetSocket
  sock.write = vi.fn((data: string, cb?: () => void) => {
    onWrite?.(data)
    if (cb) {
      cb()
    }
    return true
  })
  sock.end = vi.fn((cb?: () => void) => {
    if (cb) {
      cb()
    }
    return sock
  })
  sock.destroy = vi.fn()
  return sock
}

function readLog(path: string): PetVoiceLogEvent[] {
  const content = readFileSync(path, 'utf8').trim()
  if (!content) {
    return []
  }
  return content.split('\n').map((line) => JSON.parse(line) as PetVoiceLogEvent)
}

describe('PetVoiceRelay Rec 4 observability', () => {
  it('stamps relay receive/enqueue/write/receipt boundaries for an accepted event', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pet-voice-obs-'))
    const logPath = join(dir, 'pet-voice.ndjson')
    try {
      const logger = new PetVoiceLogger({ filePath: logPath, batchWindowMs: 0 })
      const captured: { socket: MockPetSocket | null } = { socket: null }
      const mockConnect: PetVoiceRelayOptions['connectFn'] = vi.fn(
        (_path: string, onConnect?: () => void) => {
          const sock = createMockPetSocket((data) => {
            if (data.includes('subscribe')) {
              captured.socket = sock
            }
            if (data.includes('speak-accepted')) {
              process.nextTick(() => {
                sock.emit(
                  'data',
                  Buffer.from('{"ok":true,"accepted":true,"event_id":"ev-obs-accept"}\n')
                )
              })
            }
          })
          process.nextTick(() => onConnect?.())
          return sock as unknown as Socket
        }
      )
      const relay = new PetVoiceRelay({
        connectFn: mockConnect,
        petSocketPath: '/tmp/test-pet.sock',
        logger
      })
      await new Promise((resolve) => process.nextTick(resolve))
      await relay.onVoiceSubscriptionPresenceChange(1)
      const subscriber = captured.socket
      if (!subscriber) {
        throw new Error('subscriber socket was not captured')
      }
      subscriber.emit(
        'data',
        Buffer.from(
          `${JSON.stringify({ kind: 'speak-intent', text: '觀察接收', event_id: 'ev-obs-accept', rate: 1.2 })}\n`
        )
      )
      await expect(relay.sendSpeakAccepted('ev-obs-accept')).resolves.toEqual({ accepted: true })
      logger.flush()

      const lines = readLog(logPath)
      const boundaries = lines
        .filter((row) => row.kind === 'boundary')
        .map((row) => (row as { boundary: string }).boundary)
      expect(boundaries).toEqual(
        expect.arrayContaining(['relay_receive', 'relay_enqueue', 'relay_write', 'relay_receipt'])
      )
      const receipt = lines.find(
        (row) =>
          row.kind === 'boundary' && (row as { boundary?: string }).boundary === 'relay_receipt'
      ) as { accepted?: boolean; event_id?: string } | undefined
      expect(receipt).toMatchObject({ event_id: 'ev-obs-accept', accepted: true })
      relay.destroy()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns receipt_timeout when the acceptance deadline expires', async () => {
    vi.useFakeTimers()
    const socket = createMockPetSocket()
    const mockConnect: PetVoiceRelayOptions['connectFn'] = vi.fn(
      (_path: string, onConnect?: () => void) => {
        process.nextTick(() => onConnect?.())
        return socket as unknown as Socket
      }
    )
    const relay = new PetVoiceRelay({
      connectFn: mockConnect,
      petSocketPath: '/tmp/test-pet.sock',
      acceptanceDeadlineMs: 10
    })
    const result = relay.sendSpeakAccepted('ev-obs-timeout')
    await vi.advanceTimersByTimeAsync(10)
    await expect(result).resolves.toEqual({ accepted: false, reason: 'receipt_timeout' })
    relay.destroy()
    vi.useRealTimers()
  })

  it('returns transport_teardown for a malformed acceptance receipt', async () => {
    const mockConnect: PetVoiceRelayOptions['connectFn'] = vi.fn(
      (_path: string, onConnect?: () => void) => {
        const sock = createMockPetSocket((data) => {
          if (data.includes('speak-accepted')) {
            process.nextTick(() => sock.emit('data', Buffer.from('not-json\n')))
          }
        })
        process.nextTick(() => onConnect?.())
        return sock as unknown as Socket
      }
    )
    const relay = new PetVoiceRelay({ connectFn: mockConnect, petSocketPath: '/tmp/test-pet.sock' })
    await expect(relay.sendSpeakAccepted('ev-obs-malformed')).resolves.toEqual({
      accepted: false,
      reason: 'transport_teardown'
    })
    relay.destroy()
  })

  it('forwards optional complete reason on the unix speak-complete line', async () => {
    const sentLines: string[] = []
    const mockConnect: PetVoiceRelayOptions['connectFn'] = vi.fn(
      (_path: string, onConnect?: () => void) => {
        const sock = createMockPetSocket((data) => sentLines.push(data))
        process.nextTick(() => onConnect?.())
        return sock as unknown as Socket
      }
    )
    const relay = new PetVoiceRelay({
      connectFn: mockConnect,
      petSocketPath: '/tmp/test-pet.sock'
    })
    await relay.sendSpeakComplete('ev-obs-cancel', 'cancelled', 'operator_interruption')
    expect(sentLines).toContain(
      `${JSON.stringify({
        kind: 'speak-complete',
        event_id: 'ev-obs-cancel',
        outcome: 'cancelled',
        reason: 'operator_interruption',
        speak: false
      })}\n`
    )
    relay.destroy()
  })
})

describe('pet.speak RPC Rec 4 observability', () => {
  it('accepts optional reason and timestamps on complete without breaking the legacy payload', () => {
    const completeMethod = ALL_RPC_METHODS.find((m) => m.name === 'pet.speak.complete') as RpcMethod
    expect(completeMethod.params?.parse({ event_id: 'ev-legacy', outcome: 'spoken' })).toEqual({
      event_id: 'ev-legacy',
      outcome: 'spoken'
    })
    expect(
      completeMethod.params?.parse({
        event_id: 'ev-coded',
        outcome: 'cancelled',
        reason: 'capacity_rejection',
        timestamps: { cancellation_send: 1700000000000 }
      })
    ).toEqual({
      event_id: 'ev-coded',
      outcome: 'cancelled',
      reason: 'capacity_rejection',
      timestamps: { cancellation_send: 1700000000000 }
    })
    expect(() =>
      completeMethod.params?.parse({
        event_id: 'ev-bad',
        outcome: 'cancelled',
        reason: 'not-a-reason'
      })
    ).toThrow()
    expect(PET_SPEAK_CANCEL_REASONS).toContain('queue_replacement')
  })

  it('accepts optional timestamps on pet.speak.accepted', () => {
    const acceptedMethod = ALL_RPC_METHODS.find((m) => m.name === 'pet.speak.accepted') as RpcMethod
    expect(
      acceptedMethod.params?.parse({
        event_id: 'ev-ts',
        timestamps: { mobile_queue_admission: 1, acceptance_send: 2 }
      })
    ).toEqual({
      event_id: 'ev-ts',
      timestamps: { mobile_queue_admission: 1, acceptance_send: 2 }
    })
  })

  it('logs inbound complete timestamps and forwards the reason to the runtime handler', async () => {
    const completeMethod = ALL_RPC_METHODS.find((m) => m.name === 'pet.speak.complete') as RpcMethod
    const handlePetSpeakComplete = vi.fn().mockResolvedValue({ completed: true })
    const logBoundary = vi.fn()
    const runtime = {
      handlePetSpeakComplete,
      getPetVoiceRelay: () => ({ getLogger: () => ({ logBoundary }) })
    } as unknown as OrcaRuntimeService

    await completeMethod.handler(
      {
        event_id: 'ev-rpc-obs',
        outcome: 'cancelled',
        reason: 'disconnection',
        timestamps: { cancellation_send: 42 }
      },
      { runtime, connectionId: 'conn-obs' } as unknown as RpcContext
    )

    expect(handlePetSpeakComplete).toHaveBeenCalledWith('ev-rpc-obs', 'cancelled', 'disconnection')
    expect(logBoundary).toHaveBeenCalledWith(
      expect.objectContaining({
        event_id: 'ev-rpc-obs',
        boundary: 'cancellation_send',
        timestamps: { cancellation_send: 42 },
        reason: 'disconnection'
      })
    )
  })
})
