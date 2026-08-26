import { StyleSheet, Text } from 'react-native'
import { HomeAccountUsageCard } from '../components/HomeAccountUsageCard'
import { useVisibleUsageProviders } from '../components/use-visible-usage-providers'
import type { AccountsSnapshot } from '../components/AccountUsage'
import { useNow } from '../hooks/use-now'
import { colors, spacing } from '../theme/mobile-theme'
import type { HostProfile } from '../transport/types'

export function MobileHomeAccountUsageCards(props: {
  items: { host: HostProfile; snapshot: AccountsSnapshot }[]
  onOpen: (hostId: string) => void
}) {
  const visibleProviders = useVisibleUsageProviders()
  const now = useNow(60_000, props.items.length > 0)
  if (props.items.length === 0) {
    return null
  }
  return (
    <>
      <Text style={styles.sectionHeading}>Account usage</Text>
      {props.items.map(({ host, snapshot }) => (
        <HomeAccountUsageCard
          key={host.id}
          snapshot={snapshot}
          visibleProviders={visibleProviders}
          showHostName={props.items.length > 1}
          hostName={host.name}
          now={now}
          onPress={() => props.onOpen(host.id)}
        />
      ))}
    </>
  )
}

const styles = StyleSheet.create({
  sectionHeading: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xs
  }
})
