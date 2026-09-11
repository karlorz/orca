import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { Socket } from 'node:net'
import { ALL_RPC_METHODS } from './rpc/methods'
import type { RpcContext, RpcMethod } from './rpc/core'
import { PetVoiceRelay, type PetSpeakEvent, type PetVoiceRelayOptions } from './pet-voice-relay'
import { RuntimeRpcState } from './runtime-rpc/runtime-rpc-state'
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

  it('rejects payload if text is empty, >PET_SPEAK_MAX_TEXT_GRAPHEMES unicode chars, or lang is invalid', async () => {
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
    // 2. >2000 unicode characters
    const longText = '這是一段超過字符上限的文字。'.repeat(150) // 14*150 = 2100 chars
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

  it('forwards original_text on live speak-intent emit and drops if empty or >240 chars', async () => {
    const { captured, connectFn } = captureSubscriberConnectFn()

    const relay = new PetVoiceRelay({
      connectFn,
      petSocketPath: '/tmp/test-pet.sock'
    })
    await new Promise((r) => process.nextTick(r))

    const emitted: PetSpeakEvent[] = []
    relay.onSpeak((ev) => emitted.push(ev))
    await relay.onVoiceSubscriptionPresenceChange(1)

    // 1. Normal speak-intent with original_text
    emitCapturedSpeakIntent(captured, {
      kind: 'speak-intent',
      text: '搞掂喇',
      original_text: 'Done with task 4!',
      lang: 'yue'
    })

    // 2. Speak-intent without original_text
    emitCapturedSpeakIntent(captured, {
      kind: 'speak-intent',
      text: '冇原文',
      lang: 'yue'
    })

    // 3. Speak-intent with whitespace-only original_text -> dropped
    emitCapturedSpeakIntent(captured, {
      kind: 'speak-intent',
      text: '空白原文',
      original_text: '   ',
      lang: 'yue'
    })

    // 4. Speak-intent with overlong original_text (>240 unicode chars) -> dropped
    emitCapturedSpeakIntent(captured, {
      kind: 'speak-intent',
      text: '超長原文',
      original_text: 'x'.repeat(241),
      lang: 'yue'
    })

    expect(emitted.length).toBe(4)
    expect(emitted[0].text).toBe('搞掂喇')
    expect(emitted[0].original_text).toBe('Done with task 4!')

    expect(emitted[1].text).toBe('冇原文')
    expect(emitted[1].original_text).toBeUndefined()
    expect('original_text' in emitted[1]).toBe(false)

    expect(emitted[2].text).toBe('空白原文')
    expect(emitted[2].original_text).toBeUndefined()
    expect('original_text' in emitted[2]).toBe(false)

    expect(emitted[3].text).toBe('超長原文')
    expect(emitted[3].original_text).toBeUndefined()
    expect('original_text' in emitted[3]).toBe(false)

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

  it('forwards speak-accepted and returns only the exact GrokPet receipt', async () => {
    const sentLines: string[] = []
    const mockConnect: PetVoiceRelayOptions['connectFn'] = vi.fn(
      (_path: string, onConnect?: () => void) => {
        const sock = createMockPetSocket((data) => {
          sentLines.push(data)
          const request = JSON.parse(data) as { kind?: string; event_id?: string }
          if (request.kind === 'speak-accepted') {
            process.nextTick(() => {
              sock.emit(
                'data',
                Buffer.from(
                  `${JSON.stringify({ ok: true, accepted: true, event_id: request.event_id })}\n`
                )
              )
            })
          }
        })
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

    await expect(relay.sendSpeakAccepted('ev-accepted-1')).resolves.toEqual({ accepted: true })

    expect(sentLines.filter((line) => line.includes('speak-accepted'))).toEqual([
      `${JSON.stringify({
        kind: 'speak-accepted',
        event_id: 'ev-accepted-1',
        speak: false
      })}\n`
    ])
    relay.destroy()
  })

  it('buffers split acceptance receipts and rejects malformed or explicit false replies', async () => {
    const replies: Record<string, string[]> = {
      'ev-split': ['{"ok":true,"accepted":', 'true,"event_id":"ev-split"}\n'],
      'ev-malformed': ['not-json\n'],
      'ev-false': ['{"ok":true,"accepted":false,"event_id":"ev-false"}\n']
    }
    const mockConnect: PetVoiceRelayOptions['connectFn'] = vi.fn(
      (_path: string, onConnect?: () => void) => {
        const sock = createMockPetSocket((data) => {
          if (!data.includes('speak-accepted')) {
            return
          }
          const request = JSON.parse(data) as { event_id: string }
          for (const chunk of replies[request.event_id] ?? []) {
            process.nextTick(() => sock.emit('data', Buffer.from(chunk)))
          }
        })
        process.nextTick(() => onConnect?.())
        return sock as unknown as Socket
      }
    )
    const relay = new PetVoiceRelay({ connectFn: mockConnect, petSocketPath: '/tmp/test-pet.sock' })

    await expect(relay.sendSpeakAccepted('ev-split')).resolves.toEqual({ accepted: true })
    await expect(relay.sendSpeakAccepted('ev-malformed')).resolves.toEqual({
      accepted: false,
      reason: 'transport_teardown'
    })
    await expect(relay.sendSpeakAccepted('ev-false')).resolves.toEqual({ accepted: false })
    relay.destroy()
  })

  it('destroys the acceptance socket when the response deadline expires', async () => {
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

    const result = relay.sendSpeakAccepted('ev-no-response')
    await vi.advanceTimersByTimeAsync(10)
    await expect(result).resolves.toEqual({ accepted: false, reason: 'receipt_timeout' })
    expect(socket.destroy).toHaveBeenCalledOnce()
    relay.destroy()
    vi.useRealTimers()
  })

  it('expires queued acceptance work instead of draining a stale backlog', async () => {
    vi.useFakeTimers()
    let connectCount = 0
    const mockConnect: PetVoiceRelayOptions['connectFn'] = vi.fn(
      (_path: string, onConnect?: () => void) => {
        connectCount++
        const sock = createMockPetSocket()
        process.nextTick(() => onConnect?.())
        return sock as unknown as Socket
      }
    )
    const relay = new PetVoiceRelay({
      connectFn: mockConnect,
      petSocketPath: '/tmp/test-pet.sock',
      acceptanceDeadlineMs: 10
    })

    const first = relay.sendSpeakAccepted('ev-stalled-first')
    const stale = relay.sendSpeakAccepted('ev-stale-second')
    await vi.advanceTimersByTimeAsync(10)
    await vi.advanceTimersByTimeAsync(10)

    await expect(first).resolves.toEqual({ accepted: false, reason: 'receipt_timeout' })
    await expect(stale).resolves.toEqual({ accepted: false, reason: 'receipt_timeout' })
    expect(connectCount).toBe(2)
    relay.destroy()
    vi.useRealTimers()
  })

  it('rejects a mismatched GrokPet acceptance receipt', async () => {
    const mockConnect: PetVoiceRelayOptions['connectFn'] = vi.fn(
      (_path: string, onConnect?: () => void) => {
        const sock = createMockPetSocket((data) => {
          if (data.includes('speak-accepted')) {
            process.nextTick(() => {
              sock.emit('data', Buffer.from('{"ok":true,"accepted":true,"event_id":"ev-stale"}\n'))
            })
          }
        })
        process.nextTick(() => onConnect?.())
        return sock as unknown as Socket
      }
    )
    const relay = new PetVoiceRelay({ connectFn: mockConnect, petSocketPath: '/tmp/test-pet.sock' })

    await expect(relay.sendSpeakAccepted('ev-current')).resolves.toEqual({ accepted: false })
    relay.destroy()
  })

  it('serializes accepted before complete when the accepted socket connection is delayed', async () => {
    const sentLines: string[] = []
    let releaseAcceptedConnect: (() => void) | undefined
    let connectCount = 0
    const mockConnect: PetVoiceRelayOptions['connectFn'] = vi.fn(
      (_path: string, onConnect?: () => void) => {
        connectCount++
        const sock = createMockPetSocket((data) => {
          sentLines.push(data)
          const request = JSON.parse(data) as { kind?: string; event_id?: string }
          if (request.kind === 'speak-accepted') {
            process.nextTick(() => {
              sock.emit(
                'data',
                Buffer.from(
                  `${JSON.stringify({ ok: true, accepted: true, event_id: request.event_id })}\n`
                )
              )
            })
          }
        })
        if (connectCount === 2) {
          sock.connecting = true
          sock.writable = false
          releaseAcceptedConnect = () => {
            sock.connecting = false
            sock.writable = true
            onConnect?.()
          }
        } else {
          if (onConnect) {
            process.nextTick(onConnect)
          }
        }
        return sock as unknown as Socket
      }
    )
    const relay = new PetVoiceRelay({
      connectFn: mockConnect,
      petSocketPath: '/tmp/test-pet.sock'
    })

    const accepted = relay.sendSpeakAccepted('ev-ordered')
    const completed = relay.sendSpeakComplete('ev-ordered', 'spoken')
    await new Promise((resolve) => process.nextTick(resolve))
    expect(connectCount).toBe(2)

    releaseAcceptedConnect?.()
    await Promise.all([accepted, completed])
    expect(
      sentLines
        .map((line) => JSON.parse(line) as { kind: string })
        .map((row) => row.kind)
        .filter((kind) => kind !== 'subscribe')
    ).toEqual(['speak-accepted', 'speak-complete'])
    relay.destroy()
  })

  it('runtime RPC state propagates the relay acceptance decision unchanged', async () => {
    const runtime = new OrcaRuntimeService()
    const relay = {
      sendSpeakAccepted: vi.fn().mockResolvedValue({ accepted: false }),
      sendSpeakComplete: vi.fn(),
      onVoiceSubscriptionPresenceChange: vi.fn(),
      sendDeviceStatus: vi.fn()
    } as unknown as PetVoiceRelay
    new RuntimeRpcState({
      runtime,
      userDataPath: '/tmp/orca-rec4-runtime-state',
      platform: 'linux',
      petVoiceRelay: relay
    })

    await expect(runtime.handlePetSpeakAccepted('ev-rejected')).resolves.toEqual({
      accepted: false
    })
    expect(relay.sendSpeakAccepted).toHaveBeenCalledWith('ev-rejected')
  })

  it('registers pet.speak.accepted RPC and delegates exact validated event identity', async () => {
    const acceptedMethod = ALL_RPC_METHODS.find((m) => m.name === 'pet.speak.accepted') as RpcMethod
    expect(acceptedMethod).toBeDefined()
    expect(acceptedMethod.params?.parse({ event_id: 'ev-accepted-2' })).toEqual({
      event_id: 'ev-accepted-2'
    })
    expect(() => acceptedMethod.params?.parse({ event_id: '' })).toThrow()
    expect(() => acceptedMethod.params?.parse({ event_id: '語'.repeat(129) })).toThrow()

    const runtime = new OrcaRuntimeService()
    expect(await runtime.handlePetSpeakAccepted('ev-unhandled')).toEqual({ accepted: false })
    const handler = vi.fn().mockResolvedValue({ accepted: true })
    runtime.setPetSpeakAcceptedHandler(handler)

    const result = await acceptedMethod.handler({ event_id: 'ev-accepted-2' }, {
      runtime,
      connectionId: 'conn-mobile'
    } as unknown as RpcContext)
    expect(result).toEqual({ accepted: true })
    expect(handler).toHaveBeenCalledOnce()
    expect(handler).toHaveBeenCalledWith('ev-accepted-2')
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
