import { agentMainAgentVerdict, type AgentMainAgentVerdictSource } from './agent-main-agent-verdict'

export function automationAgentCompletionResult(row?: AgentMainAgentVerdictSource): {
  status: 'completed' | 'dispatch_failed'
  error: string | null
} {
  const verdict = row ? agentMainAgentVerdict(row) : null
  if (verdict === null || verdict === 'success') {
    return { status: 'completed', error: null }
  }
  const errors = {
    failure: 'Automation agent reported a failed turn.',
    cancellation: 'Automation agent was cancelled before completing its work.',
    superseded: 'Automation agent turn was replaced before completing its work.',
    interruption: 'Automation agent was interrupted before completing its work.',
    unconfirmed: 'Automation agent completion could not be confirmed.'
  }
  return { status: 'dispatch_failed', error: errors[verdict] }
}
