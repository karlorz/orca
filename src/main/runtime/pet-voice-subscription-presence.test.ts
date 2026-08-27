import { describe, expect, it, vi } from 'vitest'
import { PetVoiceSubscriptionTracker } from './pet-voice-subscription-tracker'
import { PetVoiceRelay } from './pet-voice-relay'
import { OrcaRuntimeService } from './orca-runtime'
import { OrcaRuntimeRpcServer } from './runtime-rpc'
import { ALL_RPC_METHODS } from './rpc/methods'
import { isStreamingMethod, type RpcContext, type RpcStreamingMethod } from './rpc/core'
import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Socket } from 'node:net'

type ReadyCollector = {
  getSubscriptionId(): string
  onEvent(event: unknown): void
}

function createReadyCollector(): ReadyCollector {
  let subId = ''
  return {
    getSubscriptionId: () => subId,
    onEvent: (event: unknown) => {
      if (
        event !== null &&
        typeof event === 'object' &&
        'type' in event &&
        event.type === 'ready' &&
        'subscriptionId' in event &&
        typeof event.subscriptionId === 'string'
      ) {
        subId = event.subscriptionId
      }
    }
  }
}

type MockSocketOptions = {
  onWrite?: (data: string) => void
}

function createMockSocket(options: MockSocketOptions = {}): Socket {
  const emitter = new EventEmitter()
  const write = vi.fn((data: string, cb?: () => void) => {
    options.onWrite?.(data)
    if (cb) {
      cb()
    }
    return true
  })
  const end = vi.fn((cb?: () => void) => {
    if (cb) {
      cb()
    }
    return emitter as unknown as Socket
  })
  const destroy = vi.fn(() => emitter as unknown as Socket)

  Object.assign(emitter, {
    write,
    end,
    destroy
  })

  return emitter as unknown as Socket
}

describe('PetVoiceSubscriptionTracker', () => {
  it('authenticated socket with NO voice stream remains dead', () => {
    let state: string | null = null
    const tracker = new PetVoiceSubscriptionTracker({
      onPresenceChange: (activeCount) => {
        state = activeCount > 0 ? 'live' : 'dead'
      }
    })

    expect(tracker.activeCount).toBe(0)
    expect(state).toBeNull() // Not called initially until state changes or initialized
  })

  it('tracks first, second, and final voice subscription transitions', () => {
    const changes: number[] = []
    const tracker = new PetVoiceSubscriptionTracker({
      onPresenceChange: (activeCount) => {
        changes.push(activeCount)
      }
    })

    // First voice subscription
    const release1 = tracker.registerSubscription('sub-1')
    expect(tracker.activeCount).toBe(1)
    expect(changes).toEqual([1])

    // Second voice subscription
    const release2 = tracker.registerSubscription('sub-2')
    expect(tracker.activeCount).toBe(2)
    expect(changes).toEqual([1, 2])

    // First cleanup -> still active
    release1()
    expect(tracker.activeCount).toBe(1)
    expect(changes).toEqual([1, 2, 1])

    // Duplicate release is idempotent
    release1()
    expect(tracker.activeCount).toBe(1)
    expect(changes).toEqual([1, 2, 1])

    // Final cleanup -> reaches 0 (dead)
    release2()
    expect(tracker.activeCount).toBe(0)
    expect(changes).toEqual([1, 2, 1, 0])
  })

  it('handles explicit unsubscribe and connection-scoped cleanup through OrcaRuntimeService', async () => {
    const voiceTransitions: number[] = []
    const tracker = new PetVoiceSubscriptionTracker({
      onPresenceChange: (count) => {
        voiceTransitions.push(count)
      }
    })

    const runtime = new OrcaRuntimeService()
    runtime.setPetVoiceSubscriptionTracker(tracker)

    const subscribeMethod = ALL_RPC_METHODS.find(
      (m) => m.name === 'pet.speak.subscribe' && isStreamingMethod(m)
    ) as RpcStreamingMethod

    const unsubscribeMethod = ALL_RPC_METHODS.find(
      (m) => m.name === 'pet.speak.unsubscribe' && !isStreamingMethod(m)
    )!

    const collector1 = createReadyCollector()
    const done1 = subscribeMethod.handler(
      undefined,
      { runtime, connectionId: 'conn-1' } as RpcContext,
      collector1.onEvent
    )

    expect(tracker.activeCount).toBe(1)
    expect(voiceTransitions).toEqual([1])

    const collector2 = createReadyCollector()
    const done2 = subscribeMethod.handler(
      undefined,
      { runtime, connectionId: 'conn-1' } as RpcContext,
      collector2.onEvent
    )

    expect(tracker.activeCount).toBe(2)
    expect(voiceTransitions).toEqual([1, 2])
    expect(collector2.getSubscriptionId()).toBeTruthy()

    // Explicit unsubscribe on sub1
    const unsubResult = await unsubscribeMethod.handler(
      { subscriptionId: collector1.getSubscriptionId() },
      { runtime, connectionId: 'conn-1' } as RpcContext,
      () => {}
    )
    expect(unsubResult).toEqual({ unsubscribed: true })

    expect(tracker.activeCount).toBe(1)
    expect(voiceTransitions).toEqual([1, 2, 1])

    // Connection cleanup on conn-1 cleans up sub2
    runtime.cleanupSubscriptionsForConnection('conn-1')
    expect(tracker.activeCount).toBe(0)
    expect(voiceTransitions).toEqual([1, 2, 1, 0])

    await Promise.all([done1, done2])
  })

  it('enforces connection ownership on pet.speak.unsubscribe: owner succeeds, stranger fails, stale connection cannot teardown reconnected stream', async () => {
    const voiceTransitions: number[] = []
    const tracker = new PetVoiceSubscriptionTracker({
      onPresenceChange: (count) => {
        voiceTransitions.push(count)
      }
    })

    const runtime = new OrcaRuntimeService()
    runtime.setPetVoiceSubscriptionTracker(tracker)

    const subscribeMethod = ALL_RPC_METHODS.find(
      (m) => m.name === 'pet.speak.subscribe' && isStreamingMethod(m)
    ) as RpcStreamingMethod

    const unsubscribeMethod = ALL_RPC_METHODS.find(
      (m) => m.name === 'pet.speak.unsubscribe' && !isStreamingMethod(m)
    )!

    // 1. Connection A subscribes
    const collectorA = createReadyCollector()
    const doneA = subscribeMethod.handler(
      undefined,
      { runtime, connectionId: 'conn-A' } as RpcContext,
      collectorA.onEvent
    )
    expect(tracker.activeCount).toBe(1)
    expect(collectorA.getSubscriptionId()).toBeTruthy()

    // 2. Connection B attempts to unsubscribe subIdA -> fails / returns false, tracker unchanged
    const strangerResult = await unsubscribeMethod.handler(
      { subscriptionId: collectorA.getSubscriptionId() },
      { runtime, connectionId: 'conn-B' } as RpcContext,
      () => {}
    )
    expect(strangerResult).toEqual({ unsubscribed: false })
    expect(tracker.activeCount).toBe(1)

    // 3. Stale old connection attempt: simulated reconnect scenario
    const staleResult = await unsubscribeMethod.handler(
      { subscriptionId: collectorA.getSubscriptionId() },
      { runtime, connectionId: 'conn-stale' } as RpcContext,
      () => {}
    )
    expect(staleResult).toEqual({ unsubscribed: false })
    expect(tracker.activeCount).toBe(1)

    // 4. Missing subscription returns true per runtime API semantics (already gone)
    const missingResult = await unsubscribeMethod.handler(
      { subscriptionId: 'pet-speak-nonexistent-999' },
      { runtime, connectionId: 'conn-A' } as RpcContext,
      () => {}
    )
    expect(missingResult).toEqual({ unsubscribed: true })

    // 5. In-process caller (no connectionId) has full teardown authority
    const collectorInproc = createReadyCollector()
    const doneInproc = subscribeMethod.handler(
      undefined,
      { runtime } as RpcContext,
      collectorInproc.onEvent
    )
    expect(tracker.activeCount).toBe(2)
    const inprocResult = await unsubscribeMethod.handler(
      { subscriptionId: collectorInproc.getSubscriptionId() },
      { runtime } as RpcContext,
      () => {}
    )
    expect(inprocResult).toEqual({ unsubscribed: true })
    expect(tracker.activeCount).toBe(1)

    // 6. Legitimate owner Connection A unsubscribes subIdA -> succeeds
    const ownerResult = await unsubscribeMethod.handler(
      { subscriptionId: collectorA.getSubscriptionId() },
      { runtime, connectionId: 'conn-A' } as RpcContext,
      () => {}
    )
    expect(ownerResult).toEqual({ unsubscribed: true })
    expect(tracker.activeCount).toBe(0)

    await Promise.all([doneA, doneInproc])
  })

  it('heartbeat / dead connection close removes presence only when subscriptions were attached', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'orca-runtime-voice-presence-'))
    const mockConnect = vi.fn((_path: string, onConnect?: () => void) => {
      const sock = createMockSocket()
      if (onConnect) {
        process.nextTick(onConnect)
      }
      return sock
    })

    const petVoiceRelay = new PetVoiceRelay({
      connectFn: mockConnect,
      petSocketPath: '/tmp/test-pet.sock'
    })

    const tracker = new PetVoiceSubscriptionTracker({
      onPresenceChange: (count) => {
        void petVoiceRelay.onVoiceSubscriptionPresenceChange(count)
      }
    })

    const runtime = new OrcaRuntimeService()
    runtime.setPetVoiceSubscriptionTracker(tracker)

    const server = new OrcaRuntimeRpcServer({
      runtime,
      userDataPath,
      enableWebSocket: false,
      petVoiceRelay
    })

    // 1. Generic mobile client connects (authenticates) -> presence remains dead (0 subscriptions)
    expect(server.getMobileSocketWiring()).toBeNull()
    expect(petVoiceRelay.getAudioSessionState()).toBe('dead')

    // 2. Client subscribes to pet.speak.subscribe on connection 'conn-ws-1'
    const subscribeMethod = ALL_RPC_METHODS.find(
      (m) => m.name === 'pet.speak.subscribe' && isStreamingMethod(m)
    ) as RpcStreamingMethod

    const collectorWs1 = createReadyCollector()
    const done = subscribeMethod.handler(
      undefined,
      { runtime, connectionId: 'conn-ws-1' } as RpcContext,
      collectorWs1.onEvent
    )

    expect(collectorWs1.getSubscriptionId()).toBeTruthy()
    expect(petVoiceRelay.getAudioSessionState()).toBe('live')

    // 3. Connection closes (heartbeat loss / socket drop) -> subscription cleanup runs -> presence becomes dead
    runtime.cleanupSubscriptionsForConnection('conn-ws-1')
    expect(petVoiceRelay.getAudioSessionState()).toBe('dead')

    await done
    server.stop()
  })

  it('proactively writes audio_session=dead to pet socket on server/tracker initialization to clear stale-live pet state before any subscription', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'orca-runtime-stale-live-'))
    const writtenLines: string[] = []
    const mockConnect = vi.fn((_path: string, onConnect?: () => void) => {
      const sock = createMockSocket({
        onWrite: (data) => {
          writtenLines.push(data)
        }
      })
      if (onConnect) {
        process.nextTick(onConnect)
      }
      return sock
    })

    const petVoiceRelay = new PetVoiceRelay({
      connectFn: mockConnect,
      petSocketPath: '/tmp/test-stale-pet.sock'
    })

    const runtime = new OrcaRuntimeService()
    const server = new OrcaRuntimeRpcServer({
      runtime,
      userDataPath,
      enableWebSocket: false,
      platform: 'darwin',
      petVoiceRelay
    })

    // Wait a tick for async initialization notification
    await new Promise((r) => setTimeout(r, 10))

    const deadConfigLine = `${JSON.stringify({
      kind: 'config',
      audio_session: 'dead',
      speak: false,
      reporter: petVoiceRelay.getReporterId()
    })}\n`

    expect(writtenLines).toContain(deadConfigLine)
    expect(petVoiceRelay.getAudioSessionState()).toBe('dead')

    server.stop()
  })
})
