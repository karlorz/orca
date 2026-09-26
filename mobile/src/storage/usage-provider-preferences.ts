import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  DEFAULT_VISIBLE_USAGE_PROVIDERS,
  USAGE_PROVIDER_IDS,
  type UsageProviderKey
} from '../components/account-usage-state'

const VISIBLE_USAGE_PROVIDERS_KEY = 'orca:visibleUsageProviders'

function knownVisibleUsageProviders(ids: string[]): UsageProviderKey[] {
  return USAGE_PROVIDER_IDS.filter((id) => ids.includes(id))
}

async function readVisibleUsageProviders(): Promise<Set<UsageProviderKey>> {
  const raw = await AsyncStorage.getItem(VISIBLE_USAGE_PROVIDERS_KEY)
  if (raw === null) {
    return new Set(DEFAULT_VISIBLE_USAGE_PROVIDERS)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return new Set(DEFAULT_VISIBLE_USAGE_PROVIDERS)
  }
  if (!Array.isArray(parsed)) {
    return new Set(DEFAULT_VISIBLE_USAGE_PROVIDERS)
  }
  return new Set(
    knownVisibleUsageProviders(parsed.filter((item): item is string => typeof item === 'string'))
  )
}

export async function loadVisibleUsageProviders(): Promise<Set<UsageProviderKey>> {
  try {
    return await readVisibleUsageProviders()
  } catch {
    return new Set(DEFAULT_VISIBLE_USAGE_PROVIDERS)
  }
}

export async function saveVisibleUsageProviders(ids: ReadonlySet<UsageProviderKey>): Promise<void> {
  await AsyncStorage.setItem(
    VISIBLE_USAGE_PROVIDERS_KEY,
    JSON.stringify(USAGE_PROVIDER_IDS.filter((id) => ids.has(id)))
  )
}

let visibleUsageWrite: Promise<Set<UsageProviderKey>> = Promise.resolve(new Set())

export function setUsageProviderVisible(
  id: UsageProviderKey,
  value: boolean
): Promise<Set<UsageProviderKey>> {
  visibleUsageWrite = visibleUsageWrite
    .catch(() => undefined)
    .then(async () => {
      const next = await readVisibleUsageProviders()
      if (value) {
        next.add(id)
      } else {
        next.delete(id)
      }
      await saveVisibleUsageProviders(next)
      return next
    })
  return visibleUsageWrite
}

export async function loadVisibleUsageProvidersSettled(): Promise<Set<UsageProviderKey>> {
  while (true) {
    const pending = visibleUsageWrite
    await pending.catch(() => undefined)
    const stored = await loadVisibleUsageProviders()
    if (pending === visibleUsageWrite) {
      return stored
    }
  }
}
