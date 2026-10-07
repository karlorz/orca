import type { AgentStateHistoryEntry } from '../../../shared/agent-status-types'
import { mainAgentStatusEqual } from '../../../shared/main-agent-status'

export function getAgentStateHistoryOverlap(
  previous: AgentStateHistoryEntry[],
  current: AgentStateHistoryEntry[]
): number {
  for (let overlap = Math.min(previous.length, current.length); overlap > 0; overlap -= 1) {
    const previousOffset = previous.length - overlap
    if (
      current.slice(0, overlap).every((entry, index) => {
        const prior = previous[previousOffset + index]
        return (
          entry.state === prior.state &&
          entry.prompt === prior.prompt &&
          entry.startedAt === prior.startedAt &&
          entry.interrupted === prior.interrupted &&
          mainAgentStatusEqual(entry.mainAgent, prior.mainAgent)
        )
      })
    ) {
      return overlap
    }
  }
  return 0
}
