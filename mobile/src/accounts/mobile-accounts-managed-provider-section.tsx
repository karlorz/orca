import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { Check } from 'lucide-react-native'
import { ClaudeIcon, OpenAIIcon } from '../components/AgentIcons'
import {
  getActiveProviderRateLimits,
  getInactiveProviderUsage,
  getUsageBarState,
  getWindowResetLabel,
  hasActiveProviderUsage,
  UsageBar,
  type AccountsSnapshot,
  type ProviderKey
} from '../components/AccountUsage'
import { CodexResetCreditAction } from '../components/CodexResetCreditAction'
import {
  getActiveCodexAccountIdForRateLimitTarget,
  getCodexResetCreditSummary
} from '../components/codex-reset-credit'
import type { CodexResetCreditExpectedScope } from '../../../src/shared/codex-reset-credit-scope'
import { colors } from '../theme/mobile-theme'
import { styles } from './mobile-accounts-screen-styles'

export function MobileAccountsManagedProviderSection(props: {
  snapshot: AccountsSnapshot
  provider: ProviderKey
  title: string
  now: number
  busyAccountId: string | null
  resettingCodex: boolean
  connected: boolean
  selectAccount: (provider: ProviderKey, accountId: string | null) => void
  codexResetSupported: boolean
  resetScope: CodexResetCreditExpectedScope | null
  resetScopeLabel: string | null
  confirmCodexReset: () => void
}) {
  const {
    snapshot,
    provider,
    title,
    now,
    busyAccountId,
    resettingCodex,
    connected,
    selectAccount,
    codexResetSupported,
    resetScope,
    resetScopeLabel,
    confirmCodexReset
  } = props
  const state = provider === 'claude' ? snapshot.claude : snapshot.codex
  const activeAccountId =
    provider === 'codex' && snapshot.codex.activeAccountIdsByRuntime
      ? getActiveCodexAccountIdForRateLimitTarget(snapshot)
      : state.activeAccountId
  const activeUsage = getActiveProviderRateLimits(snapshot, provider)
  const activeSessionBar = getUsageBarState(activeUsage, 'session')
  const activeWeeklyBar = getUsageBarState(activeUsage, 'weekly')
  const resetCredit = provider === 'codex' ? getCodexResetCreditSummary(activeUsage, now) : null
  const Icon = provider === 'claude' ? ClaudeIcon : OpenAIIcon
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Icon size={14} />
        <Text style={styles.sectionHeading}>{title}</Text>
      </View>
      <View style={styles.card}>
        <Pressable
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          onPress={() => selectAccount(provider, null)}
          disabled={busyAccountId !== null || resettingCodex || !connected}
        >
          <View style={styles.rowMain}>
            <Text style={styles.rowTitle}>System default</Text>
            <Text style={styles.rowSubtitle}>Use the agent's own login</Text>
            {activeAccountId === null && hasActiveProviderUsage(activeUsage) ? (
              <View style={styles.usageRow}>
                <UsageBar
                  label="5h"
                  usedPercent={activeSessionBar.usedPercent}
                  unavailable={activeSessionBar.unavailable}
                  loading={activeSessionBar.loading}
                  resetText={getWindowResetLabel(activeUsage, 'session', now)}
                />
                <UsageBar
                  label="7d"
                  usedPercent={activeWeeklyBar.usedPercent}
                  unavailable={activeWeeklyBar.unavailable}
                  loading={activeWeeklyBar.loading}
                  resetText={getWindowResetLabel(activeUsage, 'weekly', now)}
                />
              </View>
            ) : null}
          </View>
          <View style={styles.rowTrailing}>
            {activeAccountId === null ? (
              <Check size={16} color={colors.accentBlue} />
            ) : busyAccountId === `${provider}:default` ? (
              <ActivityIndicator size="small" color={colors.textSecondary} />
            ) : null}
          </View>
        </Pressable>

        {state.accounts.map((account) => {
          const isActive = activeAccountId === account.id
          const inactiveEntry = !isActive
            ? getInactiveProviderUsage(snapshot, provider, account.id)
            : null
          const usage = isActive ? activeUsage : (inactiveEntry?.rateLimits ?? null)
          const isFetching =
            (isActive && usage?.status === 'fetching') ||
            (!isActive && inactiveEntry?.isFetching === true)
          const sessionBar = getUsageBarState(usage, 'session', isFetching)
          const weeklyBar = getUsageBarState(usage, 'weekly', isFetching)
          return (
            <View key={account.id}>
              <View style={styles.separator} />
              <Pressable
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                onPress={() => selectAccount(provider, account.id)}
                disabled={busyAccountId !== null || resettingCodex || !connected || isActive}
              >
                <View style={styles.rowMain}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {account.email}
                  </Text>
                  <View style={styles.usageRow}>
                    <UsageBar
                      label="5h"
                      usedPercent={sessionBar.usedPercent}
                      unavailable={sessionBar.unavailable}
                      loading={sessionBar.loading}
                      resetText={getWindowResetLabel(usage, 'session', now)}
                    />
                    <UsageBar
                      label="7d"
                      usedPercent={weeklyBar.usedPercent}
                      unavailable={weeklyBar.unavailable}
                      loading={weeklyBar.loading}
                      resetText={getWindowResetLabel(usage, 'weekly', now)}
                    />
                  </View>
                  {usage?.error ? (
                    <Text style={styles.errorText} numberOfLines={1}>
                      {usage.error}
                    </Text>
                  ) : null}
                </View>
                <View style={styles.rowTrailing}>
                  {isActive ? (
                    <Check size={16} color={colors.accentBlue} />
                  ) : busyAccountId === account.id ? (
                    <ActivityIndicator size="small" color={colors.textSecondary} />
                  ) : null}
                </View>
              </Pressable>
            </View>
          )
        })}
        {resetCredit && codexResetSupported && resetScope && connected ? (
          <CodexResetCreditAction
            summary={resetCredit}
            scopeLabel={resetScopeLabel}
            busy={resettingCodex}
            disabled={resettingCodex || busyAccountId !== null || !connected}
            onPress={confirmCodexReset}
          />
        ) : null}
      </View>
    </View>
  )
}
