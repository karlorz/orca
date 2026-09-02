import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { ChevronLeft, Play, Captions } from 'lucide-react-native'
import { colors, spacing } from '../src/theme/mobile-theme'
import { styles } from '../src/pet-speak/pet-speech-settings-styles'
import {
  CANONICAL_LANGUAGES,
  type CanonicalLanguage
} from '../src/pet-speak/pet-language-normalizer'
import {
  loadPetSpeechPreferences,
  setPetSpeechEnabled,
  setPetSpeechCaptionsEnabled,
  setPetSpeechRate,
  setPetSpeechVoiceForLanguage,
  subscribePetSpeechPreferences,
  type PetSpeechPreferences
} from '../src/pet-speak/pet-speech-preferences'
import {
  getPetSpeakCaptionPreview,
  hidePetSpeakCaptionPreview,
  showPetSpeakCaptionPreview,
  subscribePetSpeakCaptionPreview
} from '../src/pet-speak/pet-speak-caption-preview'
import {
  getAvailablePetSpeechVoices,
  executeTestVoiceAsync
} from '../src/pet-speak/pet-speech-service'
import type { PetSpeechVoice } from '../src/pet-speak/pet-speak-native-adapter'

const SPEEDS = [0.8, 1, 1.2, 1.5, 2] as const

const LANGUAGE_LABELS: Record<CanonicalLanguage, string> = {
  'yue-HK': 'Cantonese (yue-HK)',
  'zh-CN': 'Mainland Mandarin (zh-CN)',
  'zh-TW': 'Taiwan Mandarin (zh-TW)',
  'en-US': 'US English (en-US)'
}

export default function PetSpeechSettingsScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()

  const [prefs, setPrefs] = useState<PetSpeechPreferences | null>(null)
  const [voices, setVoices] = useState<PetSpeechVoice[]>([])
  const [selectedLanguageTab, setSelectedLanguageTab] = useState<CanonicalLanguage>('yue-HK')
  const [testVoiceBusy, setTestVoiceBusy] = useState(false)
  const [testVoiceOutcome, setTestVoiceOutcome] = useState<string | null>(null)
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
    if (prefs?.enabled) {
      void getAvailablePetSpeechVoices().then((v) => {
        if (active) {
          setVoices(v)
        }
      })
    }
    return () => {
      active = false
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

  const handleSelectSpeed = useCallback(async (speed: number) => {
    setPrefs((prev) => (prev ? { ...prev, rate: speed } : prev))
    await setPetSpeechRate(speed)
  }, [])

  const handleSelectVoice = useCallback(
    async (lang: CanonicalLanguage, voiceName: string | null) => {
      setPrefs((prev) => {
        if (!prev) {
          return prev
        }
        const updated = { ...prev.voiceByLanguage }
        if (voiceName === null) {
          delete updated[lang]
        } else {
          updated[lang] = voiceName
        }
        return { ...prev, voiceByLanguage: updated }
      })
      await setPetSpeechVoiceForLanguage(lang, voiceName)
    },
    []
  )

  const handleRunTestVoice = useCallback(async () => {
    if (testVoiceBusy || !prefs?.enabled) {
      return
    }
    setTestVoiceBusy(true)
    setTestVoiceOutcome(null)
    try {
      const res = await executeTestVoiceAsync(selectedLanguageTab, { availableVoices: voices })
      setTestVoiceOutcome(res.outcome)
    } catch {
      setTestVoiceOutcome('playback-error')
    } finally {
      setTestVoiceBusy(false)
    }
  }, [testVoiceBusy, prefs?.enabled, selectedLanguageTab, voices])

  const handleToggleCaptionPreview = useCallback(() => {
    if (previewActive) {
      hidePetSpeakCaptionPreview()
    } else {
      showPetSpeakCaptionPreview()
    }
  }, [previewActive])

  const isEnabled = prefs?.enabled ?? false
  const captionsEnabled = prefs?.captionsEnabled ?? false
  const activeRate = prefs?.rate ?? 1

  // Same-language only: never show zh-TW/zh-HK under zh-CN (or vice versa).
  const voicesForActiveLang = voices.filter((v) => v.language === selectedLanguageTab)

  const selectedVoiceForLang = prefs?.voiceByLanguage[selectedLanguageTab]

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

        {!isEnabled ? (
          <View style={[styles.section, styles.sectionTopGap]}>
            <Text style={styles.disabledNotice}>
              Pet Speech is currently disabled. Enable to configure local voices, speed, and test
              speech.
            </Text>
          </View>
        ) : (
          <>
            <Text style={[styles.groupHeading, styles.inputGroupGap]}>TEST</Text>
            <View style={[styles.section, styles.sectionTopGap]}>
              <Pressable
                style={({ pressed }) => [styles.testVoiceRow, pressed && styles.rowPressed]}
                disabled={testVoiceBusy}
                onPress={() => void handleRunTestVoice()}
              >
                {testVoiceBusy ? (
                  <ActivityIndicator size="small" color={colors.textPrimary} />
                ) : (
                  <Play size={16} color={colors.textPrimary} />
                )}
                <Text style={styles.testVoiceLabel}>Test Voice ({selectedLanguageTab})</Text>
              </Pressable>
              <Text style={styles.testOutcomeText}>
                {`Selected voice: ${selectedVoiceForLang ?? 'Device default'}`}
              </Text>
              {testVoiceOutcome ? (
                <Text style={styles.testOutcomeText}>Outcome: {testVoiceOutcome}</Text>
              ) : null}

              <View style={styles.separator} />

              <Pressable
                style={({ pressed }) => [styles.testVoiceRow, pressed && styles.rowPressed]}
                onPress={handleToggleCaptionPreview}
              >
                <Captions size={16} color={colors.textPrimary} />
                <Text style={styles.testVoiceLabel}>
                  {previewActive ? 'Hide Live captions preview' : 'Test Live captions'}
                </Text>
              </Pressable>
            </View>
            <Text style={styles.helperText}>
              Test Voice speaks and shows captions (spoken line over original English). Test Live
              captions is a silent preview — drag, then release to save the position across
              upgrades.
            </Text>

            <Text style={[styles.groupHeading, styles.inputGroupGap]}>LANGUAGE POLICY</Text>
            <View style={[styles.section, styles.sectionTopGap]}>
              <View style={styles.row}>
                <View style={styles.rowContent}>
                  <Text style={styles.rowLabel}>Follow pet language</Text>
                  <Text style={styles.rowSublabel}>
                    Language is determined by desktop pet content. Voice and speed are configured
                    locally below.
                  </Text>
                </View>
              </View>
            </View>

            <Text style={[styles.groupHeading, styles.inputGroupGap]}>SPEED</Text>
            <View style={[styles.section, styles.sectionTopGap]}>
              <View style={styles.speedRow}>
                {SPEEDS.map((s) => {
                  const active = Math.abs(activeRate - s) < 0.05
                  return (
                    <Pressable
                      key={s}
                      onPress={() => void handleSelectSpeed(s)}
                      style={[styles.speedSegment, active && styles.speedSegmentActive]}
                    >
                      <Text
                        style={[styles.speedSegmentText, active && styles.speedSegmentTextActive]}
                      >
                        {s}x
                      </Text>
                    </Pressable>
                  )
                })}
              </View>
            </View>

            <Text style={[styles.groupHeading, styles.inputGroupGap]}>VOICES BY LANGUAGE</Text>
            <View style={styles.languageTabBar}>
              {CANONICAL_LANGUAGES.map((lang) => {
                const active = selectedLanguageTab === lang
                return (
                  <Pressable
                    key={lang}
                    onPress={() => setSelectedLanguageTab(lang)}
                    style={[styles.languageTab, active && styles.languageTabActive]}
                  >
                    <Text style={[styles.languageTabText, active && styles.languageTabTextActive]}>
                      {lang}
                    </Text>
                  </Pressable>
                )
              })}
            </View>

            <View style={[styles.section, styles.sectionTopGap]}>
              <View style={styles.voiceHeaderRow}>
                <Text style={styles.voiceSectionTitle}>{LANGUAGE_LABELS[selectedLanguageTab]}</Text>
              </View>

              <Pressable
                style={[
                  styles.voiceOptionRow,
                  !selectedVoiceForLang && styles.voiceOptionRowSelected
                ]}
                onPress={() => void handleSelectVoice(selectedLanguageTab, null)}
              >
                <View style={styles.rowContent}>
                  <Text style={styles.rowLabel}>Device default</Text>
                  <Text style={styles.rowSublabel}>System recommended voice for this locale</Text>
                </View>
                {!selectedVoiceForLang ? <Text style={styles.checkMark}>✓</Text> : null}
              </Pressable>

              {voicesForActiveLang.map((voice) => {
                const isSelected = selectedVoiceForLang === voice.name
                return (
                  <View key={voice.name}>
                    <View style={styles.separator} />
                    <Pressable
                      style={[styles.voiceOptionRow, isSelected && styles.voiceOptionRowSelected]}
                      onPress={() => void handleSelectVoice(selectedLanguageTab, voice.name)}
                    >
                      <View style={styles.rowContent}>
                        <Text style={styles.rowLabel}>{voice.name}</Text>
                        <Text style={styles.rowSublabel}>
                          {voice.locale} • {voice.network ? 'Network' : 'Offline'}
                          {voice.engine ? ` • ${voice.engine}` : ''}
                        </Text>
                      </View>
                      {isSelected ? <Text style={styles.checkMark}>✓</Text> : null}
                    </Pressable>
                  </View>
                )
              })}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  )
}
