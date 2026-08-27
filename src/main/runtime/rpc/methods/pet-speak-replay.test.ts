import { describe, expect, it, vi } from 'vitest'
import { ALL_RPC_METHODS } from './index'
import { isStreamingMethod, type RpcContext, type RpcStreamingMethod } from '../core'
import type { OrcaRuntimeService } from '../../orca-runtime'
import type { PetSpeakEvent } from '../../pet-voice-relay'
import type { ReplayablePetSpeakEvent } from '../../pet-speak-replay'

describe('pet.speak.subscribe RPC with replay and emit failure', () => {
  it('accepts optional last_seen_seq and epoch params', () => {
    const subscribeMethod = ALL_RPC_METHODS.find(
      (m) => m.name === 'pet.speak.subscribe' && isStreamingMethod(m)
    ) as RpcStreamingMethod
    expect(subscribeMethod).toBeDefined()
    expect(subscribeMethod.params).not.toBeNull()

    const parseValid = subscribeMethod.params!.safeParse({
      last_seen_seq: 10,
      epoch: 'epoch-123'
    })
    expect(parseValid.success).toBe(true)

    const parseEmpty = subscribeMethod.params!.safeParse({})
    expect(parseEmpty.success).toBe(true)
  })

  it('emits replayed events newer than last_seen_seq then live events when epoch matches', async () => {
    const subscribeMethod = ALL_RPC_METHODS.find(
      (m) => m.name === 'pet.speak.subscribe' && isStreamingMethod(m)
    ) as RpcStreamingMethod

    const emitted: unknown[] = []
    let liveListener: ((event: ReplayablePetSpeakEvent) => void) | null = null

    const mockRuntime = {
      getMissedPetSpeakSince: vi.fn((lastSeenSeq: number, epoch?: string) => {
        if (epoch === 'epoch-1' && lastSeenSeq === 1) {
          return [
            {
              type: 'pet.speak' as const,
              text: 'missed 2',
              event_id: 'ev-2',
              rate: 1.2,
              seq: 2,
              epoch: 'epoch-1',
              replayed: true
            }
          ]
        }
        return []
      }),
      onPetSpeakDispatched: vi.fn((listener: (event: ReplayablePetSpeakEvent) => void) => {
        liveListener = listener
        return () => {}
      }),
      registerSubscriptionCleanup: vi.fn(),
      getPetVoiceSubscriptionTracker: vi.fn(() => ({
        registerSubscription: vi.fn(() => vi.fn())
      }))
    } as unknown as OrcaRuntimeService

    const done = subscribeMethod.handler(
      { last_seen_seq: 1, epoch: 'epoch-1' },
      { runtime: mockRuntime, connectionId: 'conn-1' } as unknown as RpcContext,
      (event) => emitted.push(event)
    )

    // Ready should be emitted with subscriptionId and epoch
    expect(emitted[0]).toMatchObject({ type: 'ready' })
    // Replayed event emitted next
    expect(emitted[1]).toMatchObject({
      type: 'pet.speak',
      event_id: 'ev-2',
      replayed: true
    })

    // Now dispatch a live event
    liveListener!({
      type: 'pet.speak',
      text: 'live 3',
      event_id: 'ev-3',
      rate: 1.2,
      seq: 3,
      epoch: 'epoch-1'
    })

    expect(emitted[2]).toMatchObject({
      type: 'pet.speak',
      event_id: 'ev-3'
    })
  })

  it('on emit failure (dead connection), releases tracker subscription and marks event as voice-unavailable', async () => {
    const subscribeMethod = ALL_RPC_METHODS.find(
      (m) => m.name === 'pet.speak.subscribe' && isStreamingMethod(m)
    ) as RpcStreamingMethod

    let liveListener: ((event: ReplayablePetSpeakEvent) => void) | null = null
    const trackerRelease = vi.fn()
    let registeredCleanup: (() => void) | null = null

    const mockRuntime = {
      getMissedPetSpeakSince: vi.fn(() => []),
      onPetSpeakDispatched: vi.fn((listener: (event: ReplayablePetSpeakEvent) => void) => {
        liveListener = listener
        return () => {}
      }),
      registerSubscriptionCleanup: vi.fn((_id: string, cleanup: () => void) => {
        registeredCleanup = cleanup
      }),
      cleanupSubscription: vi.fn((id: string) => {
        registeredCleanup?.()
      }),
      getPetVoiceSubscriptionTracker: vi.fn(() => ({
        registerSubscription: vi.fn(() => trackerRelease)
      })),
      handlePetSpeakComplete: vi.fn().mockResolvedValue({ completed: true })
    } as unknown as OrcaRuntimeService

    const emit = vi.fn((event: unknown) => {
      if ((event as { type: string }).type === 'pet.speak') {
        throw new Error('WebSocket connection closed')
      }
    })

    const done = subscribeMethod.handler(
      {},
      { runtime: mockRuntime, connectionId: 'conn-dead' } as unknown as RpcContext,
      emit
    )

    expect(liveListener).toBeDefined()

    // Trigger live event emit which throws
    await liveListener!({
      type: 'pet.speak',
      text: 'failing speech',
      event_id: 'ev-dead-1',
      rate: 1.2,
      seq: 1,
      epoch: 'epoch-1'
    })

    // Should call tracker release or cleanupSubscription, and handlePetSpeakComplete with voice-unavailable
    expect(mockRuntime.handlePetSpeakComplete).toHaveBeenCalledWith('ev-dead-1', 'voice-unavailable')
    expect(trackerRelease).toHaveBeenCalled()
  })
})
