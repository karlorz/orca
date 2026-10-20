import type { SleepingAgentSessionRecord } from '../../../../../shared/agent-session-resume'
import { agentTurnEndedUncleanly } from '../../../../../shared/agent-main-agent-verdict'

// Why live+done arms too: kept from #16308's wake-sweep widening; hibernation itself only writes worktree-sleep notes.
export function noteArmsHibernatedPaneWake(record: SleepingAgentSessionRecord): boolean {
  return (
    record.state === 'done' &&
    record.origin !== 'quit' &&
    !(record.origin === 'live' && agentTurnEndedUncleanly(record))
  )
}

export function noteNeedsExplicitHibernatedPaneWake(record: SleepingAgentSessionRecord): boolean {
  return record.state === 'done' && record.origin !== 'quit' && record.origin !== 'live'
}
