import { useCallback, useState } from 'react'
import { ActivityIndicator, Linking, Platform, Pressable, Text, View } from 'react-native'
import { Captions, Play } from 'lucide-react-native'
import { colors } from '../theme/mobile-theme'
import { styles } from './pet-speech-settings-styles'
import { CANONICAL_LANGUAGES, type CanonicalLanguage } from './pet-language-normalizer'
import {
  setPetSpeechRate,
  setPetSpeechVoiceForLanguage,
  type PetSpeechPreferences
} from './pet-speech-preferences'
import { hidePetSpeakCaptionPreview, showPetSpeakCaptionPreview } from './pet-speak-caption-preview'
import { executeTestVoiceAsync } from './pet-speech-service'
import {
  countMatchingPetSpeechVoices,
  petSpeechVoiceMatchesLanguage,
  resolvePetSpeechSetupAction,
  openPetSpeechSetupAction
} from './pet-speech-setup-action'
import type { PetSpeechVoice } from './pet-speak-native-adapter'

const SPEEDS = [0.8, 1, 1.2, 1.5, 2] as const

const LANGUAGE_LABELS: Record<CanonicalLanguage, string> = {
  'yue-HK': 'Cantonese (yue-HK)',
  'zh-CN': 'Mainland Mandarin (zh-CN)',
  'zh-TW': 'Taiwan Mandarin (zh-TW)',
  'en-US': 'US English (en-US)'
}

export function PetSpeechSettingsEnabledControls({
  prefs,
  voices,
  selectedLanguageTab,
  onSelectLanguageTab,
  onPrefsPatch,
  previewActive
}: {
  prefs: PetSpeechPreferences
  voices: PetSpeechVoice[]
  selectedLanguageTab: CanonicalLanguage
  onSelectLanguageTab: (lang: CanonicalLanguage) => void
  onPrefsPatch: (patch: Partial<PetSpeechPreferences>) => void
  previewActive: boolean
}) {
  const [testVoiceBusy, setTestVoiceBusy] = useState(false)
  const [testVoiceOutcome, setTestVoiceOutcome] = useState<string | null>(null)

  const handleSelectSpeed = useCallback(
    async (speed: number) => {
      onPrefsPatch({ rate: speed })
      await setPetSpeechRate(speed)
    },
    [onPrefsPatch]
  )

  const handleSelectVoice = useCallback(
    async (lang: CanonicalLanguage, voiceName: string | null) => {
      const updated = { ...prefs.voiceByLanguage }
      if (voiceName === null) {
        delete updated[lang]
      } else {
        updated[lang] = voiceName
      }
      onPrefsPatch({ voiceByLanguage: updated })
      await setPetSpeechVoiceForLanguage(lang, voiceName)
    },
    [onPrefsPatch, prefs.voiceByLanguage]
  )

  const handleRunTestVoice = useCallback(async () => {
    if (testVoiceBusy) {
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
  }, [testVoiceBusy, selectedLanguageTab, voices])

  const handleToggleCaptionPreview = useCallback(() => {
    if (previewActive) {
      hidePetSpeakCaptionPreview()
    } else {
      showPetSpeakCaptionPreview()
    }
  }, [previewActive])

  const matchingVoiceCount = countMatchingPetSpeechVoices(voices, selectedLanguageTab)
  const setupAction = resolvePetSpeechSetupAction({
    platform: Platform.OS,
    matchingVoiceCount,
    catalogVoiceCount: voices.length
  })
  const voicesForActiveLang = voices.filter((v) =>
    petSpeechVoiceMatchesLanguage(v, selectedLanguageTab)
  )
  const selectedVoiceForLang = prefs.voiceByLanguage[selectedLanguageTab]

  return (
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

        {setupAction.kind !== 'none' ? (
          <>
            <View style={styles.separator} />
            <Pressable
              style={({ pressed }) => [styles.testVoiceRow, pressed && styles.rowPressed]}
              onPress={() => {
                void openPetSpeechSetupAction(setupAction, Linking).catch(() => {})
              }}
            >
              <Play size={16} color={colors.textPrimary} />
              <Text style={styles.testVoiceLabel}>
                {setupAction.kind === 'install-engine'
                  ? 'Install Google speech engine'
                  : 'Open text-to-speech settings'}
              </Text>
            </Pressable>
            <Text style={styles.setupHelperText}>
              Engine and voice data are installed by the system, not Orca. Airplane mode blocks
              Google Play. After installing, pick the engine and language in system text-to-speech
              settings.
            </Text>
          </>
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
        Test Voice speaks and shows captions (spoken line over original English). Test Live captions
        is a silent preview — drag, then release to save the position across upgrades.
      </Text>

      <Text style={[styles.groupHeading, styles.inputGroupGap]}>LANGUAGE POLICY</Text>
      <View style={[styles.section, styles.sectionTopGap]}>
        <View style={styles.row}>
          <View style={styles.rowContent}>
            <Text style={styles.rowLabel}>Follow pet language</Text>
            <Text style={styles.rowSublabel}>
              Language is determined by desktop pet content. Voice and speed are configured locally
              below.
            </Text>
          </View>
        </View>
      </View>

      <Text style={[styles.groupHeading, styles.inputGroupGap]}>SPEED</Text>
      <View style={[styles.section, styles.sectionTopGap]}>
        <View style={styles.speedRow}>
          {SPEEDS.map((s) => {
            const active = Math.abs(prefs.rate - s) < 0.05
            return (
              <Pressable
                key={s}
                onPress={() => void handleSelectSpeed(s)}
                style={[styles.speedSegment, active && styles.speedSegmentActive]}
              >
                <Text style={[styles.speedSegmentText, active && styles.speedSegmentTextActive]}>
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
              onPress={() => onSelectLanguageTab(lang)}
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
          style={[styles.voiceOptionRow, !selectedVoiceForLang && styles.voiceOptionRowSelected]}
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
  )
}
