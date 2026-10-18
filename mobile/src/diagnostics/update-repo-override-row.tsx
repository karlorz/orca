import { useEffect, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { Check } from 'lucide-react-native'
import {
  buildTimeMobileUpdateRepo,
  isAllowedMobileUpdateRepo,
  MOBILE_UPDATE_REPO_ALLOW_LIST
} from '../app-update/update-repo'
import {
  loadAppUpdateRepoOverride,
  saveAppUpdateRepoOverride
} from '../storage/app-update-preferences'
import { colors } from '../theme/mobile-theme'
import { troubleshootScreenStyles as styles } from './troubleshoot-screen-styles'

/**
 * Development-only: points the Android updater at another repo from the fixed allow-list in
 * `app-update/update-repo.ts` (no free-form input). `app/troubleshoot.tsx` mounts it behind
 * `__DEV__`, and `app-update-runtime.ts` reads the stored value only in a development build, so a
 * release APK keeps the build default even if a value was left behind. A change applies from the
 * next update check.
 */
export function UpdateRepoOverrideRow() {
  const buildRepo = buildTimeMobileUpdateRepo()
  const [override, setOverride] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let stale = false
    void loadAppUpdateRepoOverride().then((stored) => {
      if (!stale) {
        setOverride(isAllowedMobileUpdateRepo(stored) ? stored : null)
      }
    })
    return () => {
      stale = true
    }
  }, [])

  // Choosing the build default stores nothing, so "reset" and "pick the default" are one state.
  const choose = (repo: string | null) => {
    const next = repo === null || repo === buildRepo ? null : repo
    setError(null)
    void saveAppUpdateRepoOverride(next)
      .then(() => setOverride(next))
      .catch(() => setError('Could not save the update source'))
  }

  const effective = override ?? buildRepo
  return (
    <View>
      <Text style={styles.sectionHeading}>Update source (development)</Text>
      <View style={styles.section}>
        {MOBILE_UPDATE_REPO_ALLOW_LIST.map((repo, index) => (
          <View key={repo}>
            {index > 0 ? <View style={styles.separator} /> : null}
            <Pressable
              style={({ pressed }) => [styles.checkRow, pressed && styles.rowPressed]}
              testID={`update-repo-option-${repo}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: repo === effective }}
              onPress={() => choose(repo)}
            >
              <Text style={styles.checkLabel}>{repo}</Text>
              <Text style={styles.checkDetail}>{repo === buildRepo ? 'default' : ''}</Text>
              {repo === effective ? <Check size={16} color={colors.textPrimary} /> : null}
            </Pressable>
          </View>
        ))}
        {error ? (
          <>
            <View style={styles.separator} />
            <View style={styles.checkRow}>
              <Text style={[styles.checkDetail, styles.checkDetailFail]}>{error}</Text>
            </View>
          </>
        ) : null}
      </View>
      <Pressable
        style={({ pressed }) => [
          styles.diagnosticButton,
          pressed && styles.diagnosticButtonPressed,
          override === null && styles.diagnosticButtonDisabled
        ]}
        testID="update-repo-override-reset"
        onPress={() => choose(null)}
        disabled={override === null}
      >
        <Text style={styles.diagnosticButtonLabel}>Reset to default</Text>
      </Pressable>
    </View>
  )
}
