import { Text, View } from 'react-native'
import { Gauge } from 'lucide-react-native'
import {
  getActiveProviderRateLimits,
  getProviderUsageWindows,
  hasRenderableUsage,
  UsageWindowBars,
  type AccountsSnapshot,
  type UsageProviderDescriptor
} from '../components/AccountUsage'
import { GrokIcon } from '../components/AgentIcons'
import { colors } from '../theme/mobile-theme'
import { styles } from './mobile-accounts-screen-styles'

export function MobileAccountsDisplayProviderSection(props: {
  snapshot: AccountsSnapshot
  descriptor: UsageProviderDescriptor
  now: number
}) {
  const usage = getActiveProviderRateLimits(props.snapshot, props.descriptor.id)
  if (!hasRenderableUsage(props.snapshot, props.descriptor.id)) {
    return null
  }
  const windows = getProviderUsageWindows(usage)
  const fetching = usage?.status === 'fetching'
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        {props.descriptor.id === 'grok' ? (
          <GrokIcon size={14} />
        ) : (
          <Gauge size={14} color={colors.textMuted} />
        )}
        <Text style={styles.sectionHeading}>{props.descriptor.label}</Text>
      </View>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.rowMain}>
            <Text style={styles.rowTitle}>System default</Text>
            <UsageWindowBars windows={windows} fetching={fetching} now={props.now} />
            {usage?.error ? (
              <Text style={styles.errorText} numberOfLines={1}>
                {usage.error}
              </Text>
            ) : null}
          </View>
        </View>
      </View>
    </View>
  )
}
