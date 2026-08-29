import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { Socket } from 'node:net'
import { ALL_RPC_METHODS } from './rpc/methods'
import type { RpcContext, RpcMethod } from './rpc/core'
import { PetVoiceRelay, type PetSpeakEvent, type PetVoiceRelayOptions } from './pet-voice-relay'
import { OrcaRuntimeService } from './orca-runtime'

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

type CapturedPetSocket = { socket: MockPetSocket | null }

function captureSubscriberConnectFn(): {
  captured: CapturedPetSocket
  connectFn: PetVoiceRelayOptions['connectFn']
} {
  const captured: CapturedPetSocket = { socket: null }
  const connectFn: PetVoiceRelayOptions['connectFn'] = vi.fn(
    (_path: string, onConnect?: () => void) => {
      const sock = createMockPetSocket((data) => {
        if (data.includes('subscribe')) {
          captured.socket = sock
        }
      })
      if (onConnect) {
        process.nextTick(onConnect)
      }
      return sock as unknown as Socket
    }
  )
  return { captured, connectFn }
}

function emitCapturedSpeakIntent(captured: CapturedPetSocket, payload: unknown): void {
  const socket = captured.socket
  if (!socket) {
    throw new Error('subscriber socket was not captured')
  }
  socket.emit('data', Buffer.from(`${JSON.stringify(payload)}\n`))
}

describe('PetVoiceRelay - Task P2 Correlation & Validation & Completion', () => {
  it('assigns stable bounded correlation event_id if missing in speak-intent', async () => {
    const { captured, connectFn } = captureSubscriberConnectFn()

    const relay = new PetVoiceRelay({
      connectFn,
      petSocketPath: '/tmp/test-pet.sock'
    })
    await new Promise((r) => process.nextTick(r))

    const emitted: PetSpeakEvent[] = []
    relay.onSpeak((ev) => emitted.push(ev))
    await relay.onVoiceSubscriptionPresenceChange(1)

    // Intent without event_id
    emitCapturedSpeakIntent(captured, { kind: 'speak-intent', text: 'Hello', lang: 'yue' })

    expect(emitted.length).toBe(1)
    expect(emitted[0].text).toBe('Hello')
    expect(emitted[0].lang).toBe('yue-HK')
    expect(emitted[0].event_id).toBeDefined()
    expect(typeof emitted[0].event_id).toBe('string')
    expect(emitted[0].event_id!.length).toBeGreaterThan(0)
    expect(emitted[0].event_id!.length).toBeLessThanOrEqual(128)

    relay.destroy()
  })

  it('rejects payload if text is empty, >70 unicode chars, or lang is invalid', async () => {
    const { captured, connectFn } = captureSubscriberConnectFn()

    const relay = new PetVoiceRelay({
      connectFn,
      petSocketPath: '/tmp/test-pet.sock'
    })
    await new Promise((r) => process.nextTick(r))

    const emitted: PetSpeakEvent[] = []
    relay.onSpeak((ev) => emitted.push(ev))
    await relay.onVoiceSubscriptionPresenceChange(1)

    // 1. Empty text
    emitCapturedSpeakIntent(captured, { kind: 'speak-intent', text: '   ', lang: 'yue' })
    // 2. >70 unicode characters
    const longText = '這是一段超過七十個字符的文字。'.repeat(6) // 15*6 = 90 chars
    emitCapturedSpeakIntent(captured, { kind: 'speak-intent', text: longText, lang: 'yue' })
    // 3. Unsupported language (e.g., fr, es, de)
    emitCapturedSpeakIntent(captured, {
      kind: 'speak-intent',
      text: 'Bonjour monde',
      lang: 'fr-FR'
    })
    // 4. Overlong event_id (>128 chars)
    const longEventId = 'a'.repeat(129)
    emitCapturedSpeakIntent(captured, {
      kind: 'speak-intent',
      text: 'Valid text',
      lang: 'yue',
      event_id: longEventId
    })
    // 5. Valid canonical/legacy variants
    emitCapturedSpeakIntent(captured, {
      kind: 'speak-intent',
      text: '你好一',
      lang: 'yue-hk',
      event_id: 'ev-1'
    })
    emitCapturedSpeakIntent(captured, {
      kind: 'speak-intent',
      text: '你好二',
      lang: 'Cantonese',
      event_id: 'ev-2'
    })
    emitCapturedSpeakIntent(captured, {
      kind: 'speak-intent',
      text: '你好三',
      lang: 'ZH-HK',
      event_id: 'ev-3'
    })

    expect(emitted.length).toBe(3)
    expect(emitted.map((e) => e.text)).toEqual(['你好一', '你好二', '你好三'])

    relay.destroy()
  })

  it('forwards speak-complete to pet socket as exact single JSON line with no replay', async () => {
    const sentLines: string[] = []
    const mockConnect: PetVoiceRelayOptions['connectFn'] = vi.fn(
      (_path: string, onConnect?: () => void) => {
        const sock = createMockPetSocket((data) => sentLines.push(data))
        if (onConnect) {
          process.nextTick(onConnect)
        }
        return sock as unknown as Socket
      }
    )

    const relay = new PetVoiceRelay({
      connectFn: mockConnect,
      petSocketPath: '/tmp/test-pet.sock'
    })

    await relay.sendSpeakComplete('ev-100', 'spoken')

    expect(sentLines).toContain(
      `${JSON.stringify({
        kind: 'speak-complete',
        event_id: 'ev-100',
        outcome: 'spoken',
        speak: false
      })}\n`
    )

    relay.destroy()
  })

  it('registers pet.speak.complete RPC method and validates params schema', async () => {
    const completeMethod = ALL_RPC_METHODS.find((m) => m.name === 'pet.speak.complete') as RpcMethod
    expect(completeMethod).toBeDefined()

    const mockRuntime = {
      handlePetSpeakComplete: vi.fn().mockResolvedValue({ completed: true })
    } as unknown as OrcaRuntimeService

    // Valid call
    const result = await completeMethod.handler({ event_id: 'ev-test-1', outcome: 'spoken' }, {
      runtime: mockRuntime,
      connectionId: 'conn-1'
    } as unknown as RpcContext)
    expect(result).toEqual({ completed: true })
    expect(mockRuntime.handlePetSpeakComplete).toHaveBeenCalledWith('ev-test-1', 'spoken')

    // Invalid outcomes must fail schema validation
    expect(() =>
      completeMethod.params?.parse({ event_id: 'ev-test-1', outcome: 'unknown-outcome' })
    ).toThrow()

    // Empty event_id must fail
    expect(() => completeMethod.params?.parse({ event_id: '', outcome: 'spoken' })).toThrow()

    // Overlong event_id (>128 chars) must fail
    expect(() =>
      completeMethod.params?.parse({ event_id: 'a'.repeat(129), outcome: 'spoken' })
    ).toThrow()
  })

  it('returns completed: false when no relay completion handler is registered on runtime', async () => {
    const completeMethod = ALL_RPC_METHODS.find((m) => m.name === 'pet.speak.complete') as RpcMethod
    expect(completeMethod).toBeDefined()

    const mockRuntime = {} as unknown as OrcaRuntimeService

    const result = await completeMethod.handler(
      { event_id: 'ev-test-nohandler', outcome: 'spoken' },
      { runtime: mockRuntime, connectionId: 'conn-1' } as unknown as RpcContext
    )
    expect(result).toEqual({ completed: false })
  })

  it('OrcaRuntimeService.handlePetSpeakComplete returns { completed: false } without stored handler and delegates when stored', async () => {
    const runtime = new OrcaRuntimeService()

    // 1. Without stored completion handler -> returns { completed: false }
    const unhandledResult = await runtime.handlePetSpeakComplete('ev-real-1', 'spoken')
    expect(unhandledResult).toEqual({ completed: false })

    // 2. With stored completion handler -> delegates and preserves arguments and return value
    const mockHandler = vi.fn().mockResolvedValue({ completed: true })
    runtime.setPetSpeakCompleteHandler(mockHandler)

    const handledResult = await runtime.handlePetSpeakComplete('ev-real-2', 'cancelled')
    expect(handledResult).toEqual({ completed: true })
    expect(mockHandler).toHaveBeenCalledWith('ev-real-2', 'cancelled')
  })
})
