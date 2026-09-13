import { useCallback, useEffect, useState } from 'react'
import { AppState, Platform, Pressable, Switch, Text, View } from 'react-native'
import { colors } from '../theme/mobile-theme'
import { styles } from './pet-speech-settings-styles'
import {
  setPetSpeechKeepWhenNoHost,
  setPetSpeechOverlayWhileSpeaking,
  setPetSpeechPersistEnabled,
  setPetSpeechShowServiceStatusRow,
  type PetSpeechPreferences
} from './pet-speech-preferences'
import {
  loadPetSpeechPersistChecklist,
  openPetSpeechPersistChecklistItem
} from './pet-speech-persist-checklist'
import type { PetSpeechPersistChecklist } from '@orca/expo-pet-speech'

export function PetSpeechPersistSettingsPanel({
  prefs,
  onPrefsPatch
}: {
  prefs: PetSpeechPreferences
  onPrefsPatch: (patch: Partial<PetSpeechPreferences>) => void
}) {
  const [checklist, setChecklist] = useState<PetSpeechPersistChecklist | null>(null)

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return
    }
    let active = true
    const refresh = () => {
      void loadPetSpeechPersistChecklist().then((status) => {
        if (active) {
          setChecklist(status)
        }
      })
    }
    refresh()
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active') {
        refresh()
      }
    })
    return () => {
      active = false
      subscription.remove()
    }
  }, [])

  const handleTogglePersist = useCallback(
    async (persistEnabled: boolean) => {
      onPrefsPatch({ persistEnabled })
      await setPetSpeechPersistEnabled(persistEnabled)
    },
    [onPrefsPatch]
  )

  const handleToggleKeepWhenNoHost = useCallback(
    async (keepWhenNoHost: boolean) => {
      onPrefsPatch({ keepWhenNoHost })
      await setPetSpeechKeepWhenNoHost(keepWhenNoHost)
    },
    [onPrefsPatch]
  )

  const handleToggleServiceRow = useCallback(
    async (showServiceStatusRow: boolean) => {
      onPrefsPatch({ showServiceStatusRow })
      await setPetSpeechShowServiceStatusRow(showServiceStatusRow)
    },
    [onPrefsPatch]
  )

  const handleToggleOverlay = useCallback(
    async (overlayWhileSpeaking: boolean) => {
      onPrefsPatch({ overlayWhileSpeaking })
      await setPetSpeechOverlayWhileSpeaking(overlayWhileSpeaking)
    },
    [onPrefsPatch]
  )

  return (
    <>
      <Text style={[styles.groupHeading, styles.inputGroupGap]}>PERSIST</Text>
      <View style={[styles.section, styles.sectionTopGap]}>
        <View style={styles.row}>
          <View style={styles.rowContent}>
            <Text style={styles.rowLabel}>Keep after reboot</Text>
            <Text style={styles.rowSublabel}>
              After reboot, tap Resume Pet voice. The service never silent-starts from boot.
            </Text>
          </View>
          <Switch
            value={prefs.persistEnabled}
            onValueChange={(v) => void handleTogglePersist(v)}
            trackColor={{ false: colors.bgRaised, true: colors.textSecondary }}
            thumbColor={colors.textPrimary}
          />
        </View>
        <View style={styles.row}>
          <View style={styles.rowContent}>
            <Text style={styles.rowLabel}>Keep when no host</Text>
            <Text style={styles.rowSublabel}>
              Off by default. Off reconnects then releases. On keeps an idle hold with no host.
            </Text>
          </View>
          <Switch
            value={prefs.keepWhenNoHost}
            onValueChange={(v) => void handleToggleKeepWhenNoHost(v)}
            trackColor={{ false: colors.bgRaised, true: colors.textSecondary }}
            thumbColor={colors.textPrimary}
          />
        </View>
        <View style={styles.row}>
          <View style={styles.rowContent}>
            <Text style={styles.rowLabel}>Show service status row</Text>
            <Text style={styles.rowSublabel}>
              Headuck-style “Pet voice service on” row. Hide without dropping the lock-screen
              player.
            </Text>
          </View>
          <Switch
            value={prefs.showServiceStatusRow}
            onValueChange={(v) => void handleToggleServiceRow(v)}
            trackColor={{ false: colors.bgRaised, true: colors.textSecondary }}
            thumbColor={colors.textPrimary}
          />
        </View>
        <View style={styles.row}>
          <View style={styles.rowContent}>
            <Text style={styles.rowLabel}>Overlay while speaking</Text>
            <Text style={styles.rowSublabel}>
              Ask for draw-over-apps only when this turns on. Deny still speaks via the
              notification.
            </Text>
          </View>
          <Switch
            value={prefs.overlayWhileSpeaking}
            onValueChange={(v) => void handleToggleOverlay(v)}
            trackColor={{ false: colors.bgRaised, true: colors.textSecondary }}
            thumbColor={colors.textPrimary}
          />
        </View>
      </View>

      {Platform.OS === 'android' ? (
        <>
          <Text style={[styles.groupHeading, styles.inputGroupGap]}>PERSIST CHECKLIST</Text>
          <View style={[styles.section, styles.sectionTopGap]}>
            <Pressable
              style={({ pressed }) => [styles.testVoiceRow, pressed && styles.rowPressed]}
              onPress={() => {
                void openPetSpeechPersistChecklistItem('notifications')
              }}
            >
              <Text style={styles.testVoiceLabel}>
                Notifications: {checklist?.notificationsGranted ? 'granted' : 'needed'}
              </Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.testVoiceRow, pressed && styles.rowPressed]}
              onPress={() => {
                void openPetSpeechPersistChecklistItem('battery')
              }}
            >
              <Text style={styles.testVoiceLabel}>
                Ignore battery: {checklist?.ignoringBattery ? 'yes' : 'open settings'}
              </Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.testVoiceRow, pressed && styles.rowPressed]}
              onPress={() => {
                void openPetSpeechPersistChecklistItem('lock-channel')
              }}
            >
              <Text style={styles.testVoiceLabel}>Show Pet voice on lock screen</Text>
            </Pressable>
            {checklist?.canOpenDeviceGuard ? (
              <Pressable
                style={({ pressed }) => [styles.testVoiceRow, pressed && styles.rowPressed]}
                onPress={() => {
                  void openPetSpeechPersistChecklistItem('device-guard')
                }}
              >
                <Text style={styles.testVoiceLabel}>Open Motorola Device Guard</Text>
              </Pressable>
            ) : null}
          </View>
        </>
      ) : null}
    </>
  )
}
