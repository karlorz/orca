import { beforeEach, describe, expect, it, vi } from 'vitest'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createWatermarkStore, createSeenGuard } from './watermark-storage'

vi.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>()
  return {
    default: {
      getItem: vi.fn(async (key: string) => store.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => {
        store.set(key, value)
      }),
      removeItem: vi.fn(async (key: string) => {
        store.delete(key)
      }),
      clear: vi.fn(async () => {
        store.clear()
      })
    }
  }
})

describe('createWatermarkStore', () => {
  const watermarkStore = createWatermarkStore({
    prefix: 'orca:testWatermark:',
    legacyPrefix: 'orca:legacyWatermark:',
    monotonicOnly: true
  })

  beforeEach(async () => {
    await AsyncStorage.clear()
    vi.clearAllMocks()
  })

  it('loads empty when nothing is stored', async () => {
    const loaded = await watermarkStore.loadWatermark('host-1')
    expect(loaded).toEqual({ seq: 0, epoch: null, stored: false })
  })

  it('saves and loads watermark correctly', async () => {
    await watermarkStore.saveWatermark('host-1', { seq: 5, epoch: 'ep-1' })
    const loaded = await watermarkStore.loadWatermark('host-1')
    expect(loaded).toEqual({ seq: 5, epoch: 'ep-1', stored: true })
  })

  it('enforces monotonic sequence advance on saveWatermark for matching epoch', async () => {
    await watermarkStore.saveWatermark('host-1', { seq: 10, epoch: 'ep-1' })

    // An older/replayed seq arrives for the same epoch
    await watermarkStore.saveWatermark('host-1', { seq: 8, epoch: 'ep-1' })

    const loaded = await watermarkStore.loadWatermark('host-1')
    expect(loaded.seq).toBe(10)
  })

  it('allows sequence reset when epoch changes', async () => {
    await watermarkStore.saveWatermark('host-1', { seq: 10, epoch: 'ep-1' })

    // New epoch with seq 1 (e.g. desktop restarted)
    await watermarkStore.saveWatermark('host-1', { seq: 1, epoch: 'ep-2' })

    const loaded = await watermarkStore.loadWatermark('host-1')
    expect(loaded).toEqual({ seq: 1, epoch: 'ep-2', stored: true })
  })

  it('clears primary and legacy keys on clearWatermark', async () => {
    await watermarkStore.saveWatermark('host-1', { seq: 5, epoch: 'ep-1' })
    await watermarkStore.clearWatermark('host-1')

    expect(AsyncStorage.removeItem).toHaveBeenCalledWith('orca:testWatermark:host-1')
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith('orca:legacyWatermark:host-1')
  })
})

describe('createSeenGuard', () => {
  it('tracks seen items up to capacity in FIFO order', () => {
    const guard = createSeenGuard(3)
    guard.add('a')
    guard.add('b')
    guard.add('c')
    expect(guard.has('a')).toBe(true)
    expect(guard.has('b')).toBe(true)
    expect(guard.has('c')).toBe(true)

    guard.add('d')
    expect(guard.has('a')).toBe(false)
    expect(guard.has('d')).toBe(true)
  })
})
