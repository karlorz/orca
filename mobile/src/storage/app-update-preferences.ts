import AsyncStorage from '@react-native-async-storage/async-storage'
import { z } from 'zod'

const LAST_CHECKED_AT_KEY = 'orca:appUpdate:lastCheckedAt'
const LATEST_KEY = 'orca:appUpdate:latest'
const DISMISSED_VERSION_KEY = 'orca:appUpdate:dismissedVersion'
const REPO_OVERRIDE_KEY = 'orca:appUpdate:repoOverride'

export type KnownAppUpdate = { readonly version: string; readonly url: string }

export type AppUpdatePreferences = {
  readonly lastCheckedAt: number | null
  readonly latest: KnownAppUpdate | null
  readonly dismissedVersion: string | null
}

export const EMPTY_APP_UPDATE_PREFERENCES: AppUpdatePreferences = {
  lastCheckedAt: null,
  latest: null,
  dismissedVersion: null
}

const knownAppUpdateSchema = z.object({ version: z.string(), url: z.string() })

// Discard only the corrupt field; preserve adjacent check and dismissal state.
function parseLatest(raw: string | null): KnownAppUpdate | null {
  try {
    const parsed = raw ? knownAppUpdateSchema.safeParse(JSON.parse(raw)) : null
    return parsed?.success ? parsed.data : null
  } catch {
    return null
  }
}

export async function loadAppUpdatePreferences(): Promise<AppUpdatePreferences> {
  try {
    const [[, checkedAt], [, latest], [, dismissed]] = await AsyncStorage.multiGet([
      LAST_CHECKED_AT_KEY,
      LATEST_KEY,
      DISMISSED_VERSION_KEY
    ])
    const lastCheckedAt = checkedAt === null ? null : Number(checkedAt)
    return {
      lastCheckedAt:
        lastCheckedAt !== null && Number.isFinite(lastCheckedAt) ? lastCheckedAt : null,
      latest: parseLatest(latest),
      dismissedVersion: dismissed
    }
  } catch {
    return EMPTY_APP_UPDATE_PREFERENCES
  }
}

export async function saveAppUpdateCheck(checkedAt: number, latest: KnownAppUpdate | null) {
  await AsyncStorage.multiSet([
    [LAST_CHECKED_AT_KEY, String(checkedAt)],
    [LATEST_KEY, latest ? JSON.stringify(latest) : '']
  ])
}

export async function saveDismissedAppUpdateVersion(version: string): Promise<void> {
  await AsyncStorage.setItem(DISMISSED_VERSION_KEY, version)
}

/** Development-only `owner/repo` the Android updater reads instead of the build default. */
export async function loadAppUpdateRepoOverride(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(REPO_OVERRIDE_KEY)
    return raw ? raw : null
  } catch {
    return null
  }
}

/** Stores the override, or clears it when `repo` is null (reset to the build default). */
export async function saveAppUpdateRepoOverride(repo: string | null): Promise<void> {
  if (repo === null) {
    await AsyncStorage.removeItem(REPO_OVERRIDE_KEY)
    return
  }
  await AsyncStorage.setItem(REPO_OVERRIDE_KEY, repo)
}
