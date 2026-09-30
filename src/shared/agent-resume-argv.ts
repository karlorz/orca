import type { AgentProviderSessionMetadata, ResumableTuiAgent } from './agent-session-resume'

export function getAgentResumeArgv(
  agent: ResumableTuiAgent,
  providerSession: AgentProviderSessionMetadata,
  ompResumeFilePath?: string | null
): string[] | null {
  const id = providerSession.id
  switch (agent) {
    case 'codebuddy':
      return providerSession.key === 'session_id' ? ['codebuddy', '--resume', id] : null
    case 'claude':
      return providerSession.key === 'session_id' ? ['claude', '--resume', id] : null
    case 'codex':
      return providerSession.key === 'session_id' ? ['codex', 'resume', id] : null
    case 'qoder':
      return providerSession.key === 'session_id' ? ['qodercli', '--resume', id] : null
    case 'gemini':
      return providerSession.key === 'session_id' ? ['gemini', '--resume', id] : null
    case 'antigravity':
      return providerSession.key === 'conversation_id' ? ['agy', '--conversation', id] : null
    case 'opencode':
      return providerSession.key === 'session_id' ? ['opencode', '--session', id] : null
    case 'opencode2':
      return providerSession.key === 'session_id'
        ? ['opencode2', '--standalone', '--session', id]
        : null
    case 'pi':
      return providerSession.key === 'session_id' && providerSession.transcriptPath
        ? ['pi', '--session', providerSession.transcriptPath]
        : null
    case 'prime-agent':
      return providerSession.key === 'session_id' && providerSession.transcriptPath
        ? ['prime-agent', '--resume', providerSession.transcriptPath]
        : null
    case 'mimo-code':
      return providerSession.key === 'session_id' ? ['mimo', '--session', id] : null
    case 'droid':
      return providerSession.key === 'session_id' ? ['droid', '--resume', id] : null
    case 'grok':
      return providerSession.key === 'session_id' ? ['grok', '--resume', id] : null
    case 'devin':
      return providerSession.key === 'session_id' ? ['devin', '--resume', id] : null
    case 'omp':
      return providerSession.key === 'session_id'
        ? [
            'omp',
            '--resume',
            ompResumeFilePath?.trim() || providerSession.transcriptPath?.trim() || id
          ]
        : null
    case 'copilot':
      return providerSession.key === 'session_id' ? ['copilot', `--resume=${id}`] : null
    case 'kimi':
      return providerSession.key === 'session_id' ? ['kimi', '--session', id] : null
    case 'muse':
      return providerSession.key === 'session_id' ? ['muse', 'resume', id] : null
    case 'zcode':
      return providerSession.key === 'session_id' ? ['zcode', '--resume', id] : null
    case 'dsh':
      return providerSession.key === 'session_id' ? ['dsh-tui', '--resume', id] : null
  }
}
