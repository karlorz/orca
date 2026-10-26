import Constants from 'expo-constants'
import * as Linking from 'expo-linking'
import { useSyncExternalStore } from 'react'
import { AppState, Platform } from 'react-native'
import {
  loadAppUpdatePreferences,
  loadAppUpdateRepoOverride,
  saveAppUpdateCheck,
  saveDismissedAppUpdateVersion
} from '../storage/app-update-preferences'
import { appStoreUpdateSource } from './app-store-update-source'
import { createAppUpdateChecker, type AppUpdateState } from './app-update-checker'
import type { AppUpdateSource } from './app-update-source'
import { createGithubReleaseUpdateSource } from './github-release-update-source'
import { buildTimeMobileUpdateRepo, resolveMobileUpdateRepo } from './update-repo'

// expoConfig is embedded binary manifest because app does not use expo-updates; SDK 55 removed nativeAppVersion. Revisit version source if adopting OTA updates.
export const installedAppVersion: string | null = Constants.expoConfig?.version ?? null

// Same guard as app/troubleshoot.tsx: `__DEV__` is undefined outside the React Native runtime.
const isDevelopmentBuild = typeof __DEV__ !== 'undefined' && __DEV__

/**
 * Android sideload channel. The repo is the build-time one (`EXPO_PUBLIC_MOBILE_UPDATE_REPO`, else
 * the fork default); only a development build also honours the Troubleshooting override, so a
 * release APK cannot be pointed at another repo from stored state.
 */
const githubReleaseUpdateSource = createGithubReleaseUpdateSource(
  (input, init) => fetch(input, init),
  () =>
    resolveMobileUpdateRepo({
      allowOverride: isDevelopmentBuild,
      loadOverride: loadAppUpdateRepoOverride,
      buildTimeRepo: buildTimeMobileUpdateRepo
    })
)

/** The channel that installed this binary. */
function resolveAppUpdateSource(): AppUpdateSource | null {
  if (Platform.OS === 'android') {
    return githubReleaseUpdateSource
  }
  if (Platform.OS === 'ios') {
    return appStoreUpdateSource
  }
  return null
}

export const appUpdateChecker = createAppUpdateChecker({
  source: resolveAppUpdateSource(),
  installedVersion: installedAppVersion,
  now: () => Date.now(),
  setTimer: (run, delayMs) => setTimeout(run, delayMs),
  clearTimer: (handle) => clearTimeout(handle),
  subscribeForeground: (onForeground) => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        onForeground()
      }
    })
    return () => subscription.remove()
  },
  loadPreferences: loadAppUpdatePreferences,
  saveCheck: saveAppUpdateCheck,
  saveDismissedVersion: saveDismissedAppUpdateVersion
})

export function useAppUpdateState(): AppUpdateState {
  return useSyncExternalStore(appUpdateChecker.subscribe, appUpdateChecker.getSnapshot)
}

/** Opens the channel's page for the update: the GitHub release (Android) or App Store (iOS). */
export function openAppUpdate(url: string): void {
  void Linking.openURL(url).catch(() => {})
}
