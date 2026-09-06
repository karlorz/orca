import { Pressable, StyleSheet, Switch, Text, View } from 'react-native'
import { ChevronRight } from 'lucide-react-native'
import { colors, spacing, typography } from '../theme/mobile-theme'
import type { MobileSpeechSetup } from '../dictation/mobile-dictation-setup'

type VoiceSpeechModelSectionProps = {
  setup: MobileSpeechSetup
  enabled: boolean
  macSpeechAvailable: boolean
  useMacSpeech: boolean
  speechModelLocked: boolean
  selectedModelLabel: string
  onToggleUseMacSpeech: (value: boolean) => void
  onOpenModelDrawer: () => void
}

export function VoiceSpeechModelSection({
  enabled,
  macSpeechAvailable,
  useMacSpeech,
  speechModelLocked,
  selectedModelLabel,
  onToggleUseMacSpeech,
  onOpenModelDrawer
}: VoiceSpeechModelSectionProps): React.JSX.Element {
  return (
    <>
      <Text style={[styles.groupHeading, styles.inputGroupGap]}>MAC SPEECH</Text>
      <View style={[styles.section, styles.sectionTopGap]}>
        <View style={[styles.row, (!enabled || !macSpeechAvailable) && styles.disabled]}>
          <View style={styles.rowContent}>
            <View style={styles.inlineLabelRow}>
              <Text style={styles.rowLabel}>Use Mac speech</Text>
              {!macSpeechAvailable && <Text style={styles.macOnlyBadge}>Mac only</Text>}
            </View>
            <Text style={styles.rowSublabel}>
              Use built-in Apple Speech. Language follows System Dictation. Speech Model is locked
              while this is on.
            </Text>
          </View>
          <Switch
            value={useMacSpeech}
            onValueChange={onToggleUseMacSpeech}
            disabled={!enabled || !macSpeechAvailable}
            trackColor={{ false: colors.bgRaised, true: colors.textSecondary }}
            thumbColor={colors.textPrimary}
          />
        </View>
      </View>

      <Text style={[styles.groupHeading, styles.inputGroupGap]}>SPEECH MODEL</Text>
      <View style={[styles.section, styles.sectionTopGap]}>
        <Pressable
          style={({ pressed }) => [
            styles.row,
            speechModelLocked && styles.disabled,
            pressed && !speechModelLocked && styles.rowPressed
          ]}
          disabled={speechModelLocked}
          onPress={onOpenModelDrawer}
        >
          <View style={styles.rowContent}>
            <Text style={styles.rowLabel}>Speech Model</Text>
            <Text style={styles.rowSublabel} numberOfLines={1}>
              {selectedModelLabel}
            </Text>
          </View>
          <ChevronRight size={18} color={colors.textMuted} />
        </Pressable>
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  groupHeading: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.xs
  },
  section: {
    backgroundColor: colors.bgPanel,
    borderRadius: 12,
    overflow: 'hidden'
  },
  sectionTopGap: { marginTop: spacing.sm },
  inputGroupGap: { marginTop: spacing.xl },
  disabled: { opacity: 0.5 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md + 2
  },
  rowPressed: { backgroundColor: colors.bgRaised },
  rowContent: { flex: 1 },
  inlineLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs
  },
  rowLabel: {
    fontSize: typography.bodySize,
    fontWeight: '500',
    color: colors.textPrimary
  },
  macOnlyBadge: {
    fontSize: typography.bodySize - 4,
    color: colors.textMuted
  },
  rowSublabel: {
    fontSize: typography.bodySize - 2,
    color: colors.textSecondary,
    marginTop: 2
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderSubtle,
    marginHorizontal: spacing.md
  }
})
