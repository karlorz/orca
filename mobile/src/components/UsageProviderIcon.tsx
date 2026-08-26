import { Gauge } from 'lucide-react-native'
import { ClaudeIcon, GrokIcon, OpenAIIcon } from './AgentIcons'
import type { UsageProviderKey } from './account-usage-state'

// Why: home cards and the accounts display section shared a grok-vs-Gauge
// ladder. Keep glyphs here so a new display provider does not grow another
// one-off branch at each call site.
export function UsageProviderIcon({
  id,
  size,
  mutedColor
}: {
  id: UsageProviderKey
  size: number
  mutedColor: string
}) {
  if (id === 'claude') {
    return <ClaudeIcon size={size} />
  }
  if (id === 'codex') {
    return <OpenAIIcon size={size} />
  }
  if (id === 'grok') {
    return <GrokIcon size={size} />
  }
  return <Gauge size={size} color={mutedColor} />
}
