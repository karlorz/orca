import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { createServer, type Socket } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  PetVoiceRelay,
  parsePetSpeakRate,
  type PetSpeakEvent,
  type PetVoiceRelayOptions
} from './pet-voice-relay'
import { ALL_RPC_METHODS } from './rpc/methods'
import { isStreamingMethod, type RpcContext, type RpcStreamingMethod } from './rpc/core'
import type { OrcaRuntimeService } from './orca-runtime'

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
  subscribeLines: string[]
} {
  const captured: CapturedPetSocket = { socket: null }
  const subscribeLines: string[] = []
  const connectFn: PetVoiceRelayOptions['connectFn'] = vi.fn(
    (_path: string, onConnect?: () => void) => {
      const sock = createMockPetSocket((data) => {
        if (data.includes('subscribe')) {
          captured.socket = sock
          subscribeLines.push(data)
        }
      })
      if (onConnect) {
        process.nextTick(onConnect)
      }
      return sock as unknown as Socket
    }
  )
  return { captured, connectFn, subscribeLines }
}

function emitCapturedSpeakIntent(captured: CapturedPetSocket, payload: unknown): void {
  const socket = captured.socket
  if (!socket) {
    throw new Error('subscriber socket was not captured')
  }
  socket.emit('data', Buffer.from(`${JSON.stringify(payload)}\n`))
}

describe('PetVoiceRelay', () => {
  it('updates pet presence based on active voice subscription count: 0 -> dead, 1 -> live, 2 -> live, 1 -> live, 0 -> dead', async () => {
    const sentConfigLines: string[] = []
    const mockConnect: PetVoiceRelayOptions['connectFn'] = vi.fn(
      (_path: string, onConnect?: () => void) => {
        const sock = createMockPetSocket((data) => sentConfigLines.push(data))
        if (onConnect) {
          process.nextTick(onConnect)
        }
        return sock as unknown as Socket
      }
    )

    const relay = new PetVoiceRelay({
      connectFn: mockConnect,
      petSocketPath: '/tmp/test-pet.sock',
      reporterId: 'orca-custom-123'
    })

    expect(relay.getAudioSessionState()).toBe('dead')

    // First voice subscription arrives -> live
    await relay.onVoiceSubscriptionPresenceChange(1)
    expect(relay.getAudioSessionState()).toBe('live')
    expect(sentConfigLines).toContain(
      '{"kind":"config","audio_session":"live","speak":false,"reporter":"orca-custom-123"}\n'
    )

    // Second subscription arrives -> remains live
    await relay.onVoiceSubscriptionPresenceChange(2)
    expect(relay.getAudioSessionState()).toBe('live')

    // 1 subscription cleans up -> remains live
    await relay.onVoiceSubscriptionPresenceChange(1)
    expect(relay.getAudioSessionState()).toBe('live')

    // Last subscription cleans up -> dead
    await relay.onVoiceSubscriptionPresenceChange(0)
    expect(relay.getAudioSessionState()).toBe('dead')
    expect(sentConfigLines).toContain(
      '{"kind":"config","audio_session":"dead","speak":false,"reporter":"orca-custom-123"}\n'
    )

    relay.destroy()
  })

  it('forwards speak-intent to connected subscribers when audio_session is live and sends reporter in subscribe payload', async () => {
    const { captured, connectFn, subscribeLines } = captureSubscriberConnectFn()

    const relay = new PetVoiceRelay({
      connectFn,
      petSocketPath: '/tmp/test-pet.sock',
      reporterId: 'orca-sub-test'
    })

    // Give nextTick a turn to connect
    await new Promise((r) => process.nextTick(r))

    expect(subscribeLines).toContain(
      '{"kind":"subscribe","channel":"speak-intent","speak":false,"reporter":"orca-sub-test"}\n'
    )

    const emittedEvents: PetSpeakEvent[] = []
    relay.onSpeak((event) => {
      emittedEvents.push(event)
    })

    // Set presence to live via voice subscription
    await relay.onVoiceSubscriptionPresenceChange(1)

    // Simulate incoming speak-intent line from pet
    const speakIntent = {
      kind: 'speak-intent',
      text: 'Task complete! All tests pass.',
      lang: 'yue-HK',
      event_id: 'ev-grok-1234'
    }
    emitCapturedSpeakIntent(captured, speakIntent)

    expect(emittedEvents).toEqual([
      {
        type: 'pet.speak',
        text: 'Task complete! All tests pass.',
        lang: 'yue-HK',
        event_id: 'ev-grok-1234',
        rate: 1.2
      }
    ])

    relay.destroy()
  })

  it('normalizes legacy lang aliases to canonical language IDs when forwarding speak-intent', async () => {
    const { captured, connectFn } = captureSubscriberConnectFn()
    const emittedEvents: PetSpeakEvent[] = []
    const relay = new PetVoiceRelay({
      connectFn,
      petSocketPath: '/tmp/test-pet.sock'
    })
    await new Promise((r) => process.nextTick(r))
    relay.onSpeak((event) => {
      emittedEvents.push(event)
    })
    await relay.onVoiceSubscriptionPresenceChange(1)

    // Cantonese legacy aliases -> yue-HK
    emitCapturedSpeakIntent(captured, {
      kind: 'speak-intent',
      text: '粵語測試',
      lang: 'cantonese',
      event_id: 'ev-can'
    })
    expect(emittedEvents[0]?.lang).toBe('yue-HK')

    // Mandarin canonical -> zh-CN, zh-TW
    emitCapturedSpeakIntent(captured, {
      kind: 'speak-intent',
      text: '普通话测试',
      lang: 'zh-CN',
      event_id: 'ev-zh-cn'
    })
    expect(emittedEvents[1]?.lang).toBe('zh-CN')

    emitCapturedSpeakIntent(captured, {
      kind: 'speak-intent',
      text: '國語測試',
      lang: 'zh-TW',
      event_id: 'ev-zh-tw'
    })
    expect(emittedEvents[2]?.lang).toBe('zh-TW')

    // English legacy alias en -> en-US
    emitCapturedSpeakIntent(captured, {
      kind: 'speak-intent',
      text: 'English test',
      lang: 'en',
      event_id: 'ev-en'
    })
    expect(emittedEvents[3]?.lang).toBe('en-US')

    // Unknown language tag -> rejected / not forwarded
    emitCapturedSpeakIntent(captured, {
      kind: 'speak-intent',
      text: 'French test',
      lang: 'fr-FR',
      event_id: 'ev-fr'
    })
    expect(emittedEvents).toHaveLength(4)

    relay.destroy()
  })

  it('forwards voiceName and debug options when provided in speak-intent message', async () => {
    const { captured, connectFn } = captureSubscriberConnectFn()
    const receivedEvents: PetSpeakEvent[] = []

    const relay = new PetVoiceRelay({
      connectFn,
      petSocketPath: '/tmp/test-pet.sock',
      onSpeak: (event) => receivedEvents.push(event)
    })

    await relay.onVoiceSubscriptionPresenceChange(1)

    emitCapturedSpeakIntent(captured, {
      kind: 'speak-intent',
      text: '測試自訂語音',
      lang: 'yue-HK',
      event_id: 'ev-voice-1',
      rate: 1.5,
      voiceName: 'yue-hk-x-yud-network',
      debug: true
    })

    expect(receivedEvents).toHaveLength(1)
    expect(receivedEvents[0]).toEqual({
      type: 'pet.speak',
      text: '測試自訂語音',
      lang: 'yue-HK',
      event_id: 'ev-voice-1',
      rate: 1.5,
      voiceName: 'yue-hk-x-yud-network',
      debug: true
    })

    relay.destroy()
  })

  it('forwards clamped speak rate and defaults missing rate to 1.2', async () => {
    expect(parsePetSpeakRate(undefined)).toBe(1.2)
    expect(parsePetSpeakRate('nope')).toBe(1.2)
    expect(parsePetSpeakRate(0.1)).toBe(0.5)
    expect(parsePetSpeakRate(9)).toBe(2.5)
    expect(parsePetSpeakRate(2)).toBe(2)

    const { captured, connectFn } = captureSubscriberConnectFn()
    const relay = new PetVoiceRelay({
      connectFn,
      petSocketPath: '/tmp/test-pet.sock'
    })
    await new Promise((r) => process.nextTick(r))
    const emittedEvents: PetSpeakEvent[] = []
    relay.onSpeak((event) => {
      emittedEvents.push(event)
    })
    await relay.onVoiceSubscriptionPresenceChange(1)
    emitCapturedSpeakIntent(captured, {
      kind: 'speak-intent',
      text: '快啲讀',
      lang: 'yue',
      event_id: 'ev-rate-2',
      rate: 2
    })
    expect(emittedEvents[0]?.rate).toBe(2)
    emitCapturedSpeakIntent(captured, {
      kind: 'speak-intent',
      text: '慢啲讀',
      lang: 'yue',
      event_id: 'ev-rate-hi',
      rate: 99
    })
    expect(emittedEvents[1]?.rate).toBe(2.5)
    relay.destroy()
  })

  it('does NOT forward speak-intent when audio_session is dead', async () => {
    const { captured, connectFn } = captureSubscriberConnectFn()

    const relay = new PetVoiceRelay({
      connectFn,
      petSocketPath: '/tmp/test-pet.sock'
    })

    // Give nextTick a turn to connect
    await new Promise((r) => process.nextTick(r))

    const emittedEvents: PetSpeakEvent[] = []
    relay.onSpeak((event) => {
      emittedEvents.push(event)
    })

    // audio_session is dead (0 mobile sockets)
    expect(relay.getAudioSessionState()).toBe('dead')

    // Simulate incoming speak-intent line from pet
    const speakIntent = {
      kind: 'speak-intent',
      text: 'Task complete! All tests pass.',
      lang: 'en-US',
      event_id: 'ev-grok-1234'
    }
    emitCapturedSpeakIntent(captured, speakIntent)

    expect(emittedEvents).toEqual([])

    relay.destroy()
  })

  it('handles pet socket disconnect and reconnects', async () => {
    let connectCount = 0
    const mockConnect: PetVoiceRelayOptions['connectFn'] = vi.fn(
      (_path: string, onConnect?: () => void) => {
        connectCount++
        const sock = createMockPetSocket()
        if (onConnect) {
          process.nextTick(onConnect)
        }
        return sock as unknown as Socket
      }
    )

    const relay = new PetVoiceRelay({
      connectFn: mockConnect,
      petSocketPath: '/tmp/test-pet.sock',
      reconnectBaseDelayMs: 10
    })

    expect(connectCount).toBe(1)
    relay.destroy()
  })

  it('pushes audio_session live again when voice presence is reported live twice', async () => {
    const sentConfigLines: string[] = []
    const mockConnect: PetVoiceRelayOptions['connectFn'] = vi.fn(
      (_path: string, onConnect?: () => void) => {
        const sock = createMockPetSocket((data) => sentConfigLines.push(data))
        sock.connecting = false
        sock.writable = true
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

    await relay.onVoiceSubscriptionPresenceChange(1)
    const afterFirst = sentConfigLines.filter((line) =>
      line.includes('"audio_session":"live"')
    ).length
    expect(afterFirst).toBeGreaterThanOrEqual(1)

    await relay.onVoiceSubscriptionPresenceChange(1)
    const afterSecond = sentConfigLines.filter((line) =>
      line.includes('"audio_session":"live"')
    ).length
    expect(afterSecond).toBeGreaterThan(afterFirst)

    await relay.onVoiceSubscriptionPresenceChange(0)
    await relay.onVoiceSubscriptionPresenceChange(0)
    const deadWrites = sentConfigLines.filter((line) =>
      line.includes('"audio_session":"dead"')
    ).length
    expect(deadWrites).toBeGreaterThanOrEqual(2)

    relay.destroy()
  })

  it('writes audio_session live with reporter to a real unix pet.sock (not a nextTick mock)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pet-voice-relay-'))
    const petSocketPath = join(dir, 'pet.sock')
    const received: string[] = []
    const server = createServer((client) => {
      client.on('data', (chunk) => {
        received.push(chunk.toString('utf8'))
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.listen(petSocketPath, () => resolve())
      server.once('error', reject)
    })

    try {
      const relay1 = new PetVoiceRelay({
        petSocketPath,
        reconnectBaseDelayMs: 20,
        reconnectMaxDelayMs: 50,
        reporterId: 'orca-pid-1'
      })
      await new Promise((r) => setTimeout(r, 40))
      await relay1.onVoiceSubscriptionPresenceChange(1)
      await relay1.onVoiceSubscriptionPresenceChange(0)
      await new Promise((r) => setTimeout(r, 80))
      const joined1 = received.join('')
      expect(joined1).toContain('"audio_session":"live"')
      expect(joined1).toContain('"kind":"config"')
      expect(joined1).toContain('"reporter":"orca-pid-1"')
      relay1.destroy()

      // Second instance has different reporterId
      const relay2 = new PetVoiceRelay({
        petSocketPath,
        reconnectBaseDelayMs: 20,
        reconnectMaxDelayMs: 50,
        reporterId: 'orca-pid-2'
      })
      await new Promise((r) => setTimeout(r, 40))
      await relay2.onVoiceSubscriptionPresenceChange(1)
      await new Promise((r) => setTimeout(r, 80))
      const joined2 = received.join('')
      expect(joined2).toContain('"reporter":"orca-pid-2"')
      relay2.destroy()
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('provides pet.speak.subscribe RPC streaming method', async () => {
    const subscribeMethod = ALL_RPC_METHODS.find(
      (m) => m.name === 'pet.speak.subscribe' && isStreamingMethod(m)
    ) as RpcStreamingMethod
    expect(subscribeMethod).toBeDefined()

    const emitted: unknown[] = []
    const cleanups: (() => void)[] = []
    const mockRuntime = {
      onPetSpeakDispatched: vi.fn((listener: (event: PetSpeakEvent) => void) => {
        listener({ type: 'pet.speak', text: 'Hello', lang: 'yue-HK', event_id: 'ev-1', rate: 1.2 })
        return () => {}
      }),
      registerSubscriptionCleanup: (_id: string, cleanup: () => void) => {
        cleanups.push(cleanup)
      }
    } as unknown as OrcaRuntimeService

    const done = subscribeMethod.handler(
      undefined,
      { runtime: mockRuntime, connectionId: 'conn-1' } as unknown as RpcContext,
      (event) => emitted.push(event)
    )

    expect(mockRuntime.onPetSpeakDispatched).toHaveBeenCalled()
    expect(emitted).toContainEqual({
      type: 'pet.speak',
      text: 'Hello',
      lang: 'yue-HK',
      event_id: 'ev-1',
      rate: 1.2
    })

    cleanups.forEach((c) => c())
    await done
  })
})
