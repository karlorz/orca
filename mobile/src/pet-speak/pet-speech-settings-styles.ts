import { StyleSheet } from 'react-native'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgBase,
    paddingHorizontal: spacing.lg
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xl
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm
  },
  heading: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.textPrimary
  },
  scrollContent: {
    paddingBottom: spacing.xl
  },
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
    borderRadius: radii.card,
    overflow: 'hidden'
  },
  sectionTopGap: { marginTop: spacing.xs },
  inputGroupGap: { marginTop: spacing.xl },
  disabledNotice: {
    fontSize: typography.bodySize,
    color: colors.textSecondary,
    padding: spacing.md,
    lineHeight: 20
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md + 2
  },
  rowPressed: { backgroundColor: colors.bgRaised },
  rowContent: { flex: 1 },
  rowLabel: {
    fontSize: typography.bodySize,
    fontWeight: '500',
    color: colors.textPrimary
  },
  rowSublabel: {
    fontSize: typography.bodySize - 2,
    color: colors.textSecondary,
    marginTop: 2
  },
  speedRow: {
    flexDirection: 'row',
    padding: spacing.sm,
    gap: spacing.xs
  },
  speedSegment: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.button,
    backgroundColor: colors.bgBase
  },
  speedSegmentActive: {
    backgroundColor: colors.bgRaised
  },
  speedSegmentText: {
    fontSize: typography.metaSize,
    color: colors.textSecondary,
    fontWeight: '600'
  },
  speedSegmentTextActive: {
    color: colors.textPrimary
  },
  languageTabBar: {
    flexDirection: 'row',
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
    backgroundColor: colors.bgPanel,
    borderRadius: radii.button,
    padding: 3
  },
  languageTab: {
    flex: 1,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.button - 1
  },
  languageTabActive: {
    backgroundColor: colors.bgRaised
  },
  languageTabText: {
    fontSize: typography.metaSize,
    color: colors.textSecondary,
    fontWeight: '600'
  },
  languageTabTextActive: {
    color: colors.textPrimary
  },
  voiceHeaderRow: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs
  },
  voiceSectionTitle: {
    fontSize: typography.metaSize,
    fontWeight: '600',
    color: colors.textMuted
  },
  voiceOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md
  },
  voiceOptionRowSelected: {
    backgroundColor: colors.bgRaised
  },
  checkMark: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
    marginLeft: spacing.sm
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderSubtle,
    marginHorizontal: spacing.md
  },
  testVoiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md
  },
  testVoiceLabel: {
    fontSize: typography.bodySize,
    fontWeight: '600',
    color: colors.textPrimary
  },
  testOutcomeText: {
    fontSize: typography.metaSize,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingBottom: spacing.sm
  }
})
