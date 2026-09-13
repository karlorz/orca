import { useCallback, useEffect, useState } from 'react'
import { AppState, Pressable, ScrollView, Switch, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { ChevronLeft } from 'lucide-react-native'
import { colors, spacing } from '../src/theme/mobile-theme'
import { styles } from '../src/pet-speak/pet-speech-settings-styles'
import type { CanonicalLanguage } from '../src/pet-speak/pet-language-normalizer'
import {
  loadPetSpeechPreferences,
  setPetSpeechEnabled,
  setPetSpeechCaptionsEnabled,
  subscribePetSpeechPreferences,
  type PetSpeechPreferences
} from '../src/pet-speak/pet-speech-preferences'
import {
  getPetSpeakCaptionPreview,
  subscribePetSpeakCaptionPreview
} from '../src/pet-speak/pet-speak-caption-preview'
import { getAvailablePetSpeechVoices } from '../src/pet-speak/pet-speech-service'
import type { PetSpeechVoice } from '../src/pet-speak/pet-speak-native-adapter'
import { PetSpeechPersistSettingsPanel } from '../src/pet-speak/pet-speech-persist-settings-panel'
import { PetSpeechSettingsEnabledControls } from '../src/pet-speak/pet-speech-settings-enabled-controls'

export default function PetSpeechSettingsScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()

  const [prefs, setPrefs] = useState<PetSpeechPreferences | null>(null)
  const [voices, setVoices] = useState<PetSpeechVoice[]>([])
  const [selectedLanguageTab, setSelectedLanguageTab] = useState<CanonicalLanguage>('yue-HK')
  const [previewActive, setPreviewActive] = useState<boolean>(
    () => getPetSpeakCaptionPreview() !== null
  )

  useEffect(() => {
    const unsub = subscribePetSpeakCaptionPreview((caption) => {
      setPreviewActive(caption !== null)
    })
    return unsub
  }, [])

  useEffect(() => {
    let active = true
    void loadPetSpeechPreferences().then((p) => {
      if (active) {
        setPrefs(p)
      }
    })
    const unsub = subscribePetSpeechPreferences((p) => {
      if (active) {
        setPrefs(p)
      }
    })
    return () => {
      active = false
      unsub()
    }
  }, [])

  useEffect(() => {
    let active = true
    const refreshVoices = () => {
      if (prefs?.enabled) {
        void getAvailablePetSpeechVoices().then((v) => {
          if (active) {
            setVoices(v)
          }
        })
      }
    }

    refreshVoices()

    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active') {
        refreshVoices()
      }
    })

    return () => {
      active = false
      subscription.remove()
    }
  }, [prefs?.enabled])

  const handleToggleEnabled = useCallback(async (enabled: boolean) => {
    setPrefs((prev) => (prev ? { ...prev, enabled } : prev))
    await setPetSpeechEnabled(enabled)
  }, [])

  const handleToggleCaptions = useCallback(async (captionsEnabled: boolean) => {
    setPrefs((prev) => (prev ? { ...prev, captionsEnabled } : prev))
    await setPetSpeechCaptionsEnabled(captionsEnabled)
  }, [])

  const handlePrefsPatch = useCallback((patch: Partial<PetSpeechPreferences>) => {
    setPrefs((prev) => (prev ? { ...prev, ...patch } : prev))
  }, [])

  const isEnabled = prefs?.enabled ?? false
  const captionsEnabled = prefs?.captionsEnabled ?? false

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.topRow}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <ChevronLeft size={22} color={colors.textSecondary} />
        </Pressable>
        <Text style={styles.heading}>Pet Speech</Text>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + spacing.xl }
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.groupHeading}>MODULE</Text>
        <View style={[styles.section, styles.sectionTopGap]}>
          <View style={styles.row}>
            <View style={styles.rowContent}>
              <Text style={styles.rowLabel}>Enable Pet Speech</Text>
              <Text style={styles.rowSublabel}>
                Speak desktop pet messages on this device using local Android TTS voices.
              </Text>
            </View>
            <Switch
              value={isEnabled}
              onValueChange={(v) => void handleToggleEnabled(v)}
              trackColor={{ false: colors.bgRaised, true: colors.textSecondary }}
              thumbColor={colors.textPrimary}
            />
          </View>
          {isEnabled ? (
            <View style={styles.row}>
              <View style={styles.rowContent}>
                <Text style={styles.rowLabel}>Live captions</Text>
                <Text style={styles.rowSublabel}>
                  Show spoken pet text when you may not hear the speaker. Off by default. Tap × on
                  the pill to turn off.
                </Text>
              </View>
              <Switch
                value={captionsEnabled}
                onValueChange={(v) => void handleToggleCaptions(v)}
                trackColor={{ false: colors.bgRaised, true: colors.textSecondary }}
                thumbColor={colors.textPrimary}
              />
            </View>
          ) : null}
        </View>

        {!isEnabled || !prefs ? (
          <View style={[styles.section, styles.sectionTopGap]}>
            <Text style={styles.disabledNotice}>
              Pet Speech is currently disabled. Enable to configure local voices, speed, and test
              speech.
            </Text>
          </View>
        ) : (
          <>
            <PetSpeechPersistSettingsPanel prefs={prefs} onPrefsPatch={handlePrefsPatch} />
            <PetSpeechSettingsEnabledControls
              prefs={prefs}
              voices={voices}
              selectedLanguageTab={selectedLanguageTab}
              onSelectLanguageTab={setSelectedLanguageTab}
              onPrefsPatch={handlePrefsPatch}
              previewActive={previewActive}
            />
          </>
        )}
      </ScrollView>
    </View>
  )
}
