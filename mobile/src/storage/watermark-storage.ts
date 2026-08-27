import AsyncStorage from '@react-native-async-storage/async-storage'

export type PersistedWatermark = { seq: number; epoch: string | null }
export type LoadedWatermark = PersistedWatermark & { stored: boolean }

export function coerceSeq(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

export type WatermarkStorageConfig = {
  prefix: string
  legacyPrefix?: string
  monotonicOnly?: boolean
}

export function createWatermarkStore(config: WatermarkStorageConfig) {
  function storageKey(hostId: string): string {
    return config.prefix + encodeURIComponent(hostId)
  }

  return {
    async loadWatermark(hostId: string): Promise<LoadedWatermark> {
      try {
        const raw = await AsyncStorage.getItem(storageKey(hostId))
        if (raw != null) {
          const parsed = JSON.parse(raw) as { seq?: unknown; epoch?: unknown }
          const epoch =
            typeof parsed.epoch === 'string' && parsed.epoch.length > 0 ? parsed.epoch : null
          return { seq: coerceSeq(parsed.seq), epoch, stored: true }
        }
      } catch {
        // Unreadable or malformed: fall through to the legacy key rather than throw.
      }
      if (config.legacyPrefix) {
        try {
          const legacy = await AsyncStorage.getItem(
            config.legacyPrefix + encodeURIComponent(hostId)
          )
          return { seq: coerceSeq(legacy), epoch: null, stored: legacy != null }
        } catch {
          // Ignore
        }
      }
      return { seq: 0, epoch: null, stored: false }
    },

    async clearWatermark(hostId: string): Promise<void> {
      const removals = [AsyncStorage.removeItem(storageKey(hostId)).catch(() => {})]
      if (config.legacyPrefix) {
        removals.push(
          AsyncStorage.removeItem(config.legacyPrefix + encodeURIComponent(hostId)).catch(() => {})
        )
      }
      await Promise.all(removals)
    },

    async saveWatermark(
      hostId: string,
      watermark: PersistedWatermark,
      options?: { force?: boolean }
    ): Promise<void> {
      try {
        let seqToStore = watermark.seq
        if (config.monotonicOnly && !options?.force) {
          const raw = await AsyncStorage.getItem(storageKey(hostId))
          if (raw != null) {
            const parsed = JSON.parse(raw) as { seq?: unknown; epoch?: unknown }
            const storedSeq = coerceSeq(parsed.seq)
            if (parsed.epoch === watermark.epoch) {
              seqToStore = Math.max(storedSeq, watermark.seq)
            }
          }
        }
        await AsyncStorage.setItem(
          storageKey(hostId),
          JSON.stringify({ seq: seqToStore, epoch: watermark.epoch })
        )
      } catch {
        // Best-effort
      }
    }
  }
}

const DEFAULT_SEEN_CAP = 512

export function createSeenGuard(capacity = DEFAULT_SEEN_CAP): {
  has: (id: string) => boolean
  add: (id: string) => void
  clear: () => void
} {
  const seen = new Set<string>()
  return {
    has(id: string): boolean {
      return seen.has(id)
    },
    add(id: string): void {
      seen.add(id)
      if (seen.size > capacity) {
        const first = seen.values().next().value
        if (first !== undefined) {
          seen.delete(first)
        }
      }
    },
    clear(): void {
      seen.clear()
    }
  }
}
