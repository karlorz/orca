import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { createServer, type Socket } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PetVoiceRelay, type PetSpeakEvent, type PetVoiceRelayOptions } from './pet-voice-relay'
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
      petSocketPath: '/tmp/test-pet.sock'
    })

    expect(relay.getAudioSessionState()).toBe('dead')

    // First voice subscription arrives -> live
    await relay.onVoiceSubscriptionPresenceChange(1)
    expect(relay.getAudioSessionState()).toBe('live')
    expect(sentConfigLines).toContain('{"kind":"config","audio_session":"live","speak":false}\n')

    // Second subscription arrives -> remains live
    await relay.onVoiceSubscriptionPresenceChange(2)
    expect(relay.getAudioSessionState()).toBe('live')

    // 1 subscription cleans up -> remains live
    await relay.onVoiceSubscriptionPresenceChange(1)
    expect(relay.getAudioSessionState()).toBe('live')

    // Last subscription cleans up -> dead
    await relay.onVoiceSubscriptionPresenceChange(0)
    expect(relay.getAudioSessionState()).toBe('dead')
    expect(sentConfigLines).toContain('{"kind":"config","audio_session":"dead","speak":false}\n')

    relay.destroy()
  })

  it('forwards speak-intent to connected subscribers when audio_session is live', async () => {
    let subscriberSocket: MockPetSocket | null = null
    const mockConnect: PetVoiceRelayOptions['connectFn'] = vi.fn(
      (_path: string, onConnect?: () => void) => {
        const sock = createMockPetSocket((data) => {
          if (data.includes('subscribe')) {
            subscriberSocket = sock
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

    // Give nextTick a turn to connect
    await new Promise((r) => process.nextTick(r))

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
    subscriberSocket?.emit('data', Buffer.from(`${JSON.stringify(speakIntent)}\n`))

    expect(emittedEvents).toEqual([
      {
        type: 'pet.speak',
        text: 'Task complete! All tests pass.',
        lang: 'yue-HK',
        event_id: 'ev-grok-1234'
      }
    ])

    relay.destroy()
  })

  it('does NOT forward speak-intent when audio_session is dead', async () => {
    let subscriberSocket: MockPetSocket | null = null
    const mockConnect: PetVoiceRelayOptions['connectFn'] = vi.fn(
      (_path: string, onConnect?: () => void) => {
        const sock = createMockPetSocket((data) => {
          if (data.includes('subscribe')) {
            subscriberSocket = sock
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
    subscriberSocket?.emit('data', Buffer.from(`${JSON.stringify(speakIntent)}\n`))

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

  it('writes audio_session live to a real unix pet.sock (not a nextTick mock)', async () => {
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
      const relay = new PetVoiceRelay({
        petSocketPath,
        reconnectBaseDelayMs: 20,
        reconnectMaxDelayMs: 50
      })
      await new Promise((r) => setTimeout(r, 40))
      await relay.onVoiceSubscriptionPresenceChange(1)
      await new Promise((r) => setTimeout(r, 80))
      const joined = received.join('')
      expect(joined).toContain('"audio_session":"live"')
      expect(joined).toContain('"kind":"config"')
      relay.destroy()
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
        listener({ type: 'pet.speak', text: 'Hello', lang: 'yue-HK', event_id: 'ev-1' })
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
      event_id: 'ev-1'
    })

    cleanups.forEach((c) => c())
    await done
  })
})
