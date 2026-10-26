// Hook-payload provider session parsing, split from agent-session-resume.ts (max-lines); re-exported there.
import type { AgentHookSource } from './agent-hook-relay'
import type { AgentProviderSessionMetadata } from './agent-session-resume'

const PROVIDER_SESSION_ID_MAX_LENGTH = 512

export function hasUnsafeProviderSessionIdChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code <= 0x1f || code === 0x7f) {
      return true
    }
  }
  return false
}

export function normalizeSessionId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  if (
    trimmed.length === 0 ||
    trimmed.length > PROVIDER_SESSION_ID_MAX_LENGTH ||
    trimmed.startsWith('-') ||
    hasUnsafeProviderSessionIdChars(trimmed)
  ) {
    return null
  }
  return trimmed
}

function readSessionId(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const normalized = normalizeSessionId(record[key])
    if (normalized) {
      return normalized
    }
  }
  return null
}

/** Read a hook-reported path; recent Claude transcript filenames cannot be reconstructed from session ID. */
export function readPathFromKeys(
  record: Record<string, unknown>,
  keys: readonly string[]
): string | undefined {
  for (const key of keys) {
    const raw = record[key]
    if (typeof raw !== 'string') {
      continue
    }
    const trimmed = raw.trim()
    if (trimmed && !hasUnsafeProviderSessionIdChars(trimmed)) {
      return trimmed
    }
  }
  return undefined
}

function withTranscriptPath(
  metadata: AgentProviderSessionMetadata,
  payload: Record<string, unknown>,
  keys: readonly string[] = ['transcript_path', 'transcriptPath']
): AgentProviderSessionMetadata {
  const transcriptPath = readPathFromKeys(payload, keys)
  return transcriptPath ? { ...metadata, transcriptPath } : metadata
}

export function extractAgentProviderSession(
  source: AgentHookSource,
  payload: Record<string, unknown>
): AgentProviderSessionMetadata | null {
  switch (source) {
    // Capture transcript_path: recent Claude filenames differ from hook session_id, defeating ID-based globs.
    case 'qoder-cn':
    case 'qwen-code':
    case 'qoder':
    case 'codebuddy':
    case 'claude':
    case 'codex': {
      const id = readSessionId(payload, ['session_id'])
      return id ? withTranscriptPath({ key: 'session_id', id }, payload) : null
    }
    case 'gemini':
    case 'droid':
    // Why: Kimi Code posts a Claude-shaped `session_id` (e.g. session_<uuid>).
    // falls through
    case 'kimi': {
      const id = readSessionId(payload, ['session_id'])
      return id ? { key: 'session_id', id } : null
    }
    case 'muse': {
      const id = readSessionId(payload, ['session_id'])
      return id ? withTranscriptPath({ key: 'session_id', id }, payload) : null
    }
    // ZCode deletes its per-invocation transcript_path temp file when the hook returns; only its ID is durable.
    case 'zcode': {
      const id = readSessionId(payload, ['session_id'])
      return id ? { key: 'session_id', id } : null
    }
    // DSH's bridge has no persistence artifact and sends an empty transcript_path; retain its session ID only.
    // Kiro also reports no transcript path; its ID feeds --resume-id.
    // Hermes' managed plugin posts the live session_id on every hook; `hermes --resume` takes it.
    case 'hermes':
    case 'kiro':
    case 'dsh': {
      const id = readSessionId(payload, ['session_id'])
      return id ? { key: 'session_id', id } : null
    }
    case 'antigravity': {
      const id = readSessionId(payload, ['conversationId'])
      return id ? { key: 'conversation_id', id } : null
    }
    case 'opencode':
    case 'opencode2':
    case 'mimo-code': {
      const id = readSessionId(payload, ['sessionID'])
      return id ? { key: 'session_id', id } : null
    }
    case 'pi':
    case 'prime-agent': {
      const id = readSessionId(payload, ['session_id'])
      const providerSession = id
        ? withTranscriptPath({ key: 'session_id', id }, payload, ['session_file'])
        : null
      return providerSession?.transcriptPath ? providerSession : null
    }
    case 'grok': {
      const id = readSessionId(payload, ['sessionId', 'session_id'])
      return id ? { key: 'session_id', id } : null
    }
    case 'devin': {
      const id = readSessionId(payload, ['session_id', 'sessionId'])
      return id ? { key: 'session_id', id } : null
    }
    case 'jcode': {
      const id = readSessionId(payload, ['session_id', 'sessionId'])
      return id ? { key: 'session_id', id } : null
    }
    // OMP keeps id-based resume while optionally locating its native-chat transcript.
    case 'omp': {
      const id = readSessionId(payload, ['session_id'])
      return id ? withTranscriptPath({ key: 'session_id', id }, payload, ['session_file']) : null
    }
    // Why: Copilot's hook `session_id` is also its `~/.copilot/session-state/<id>/`
    // directory name, so the same id is the CLI's resume locator.
    case 'copilot': {
      const id = readSessionId(payload, ['session_id', 'sessionId'])
      return id ? { key: 'session_id', id } : null
    }
    case 'cursor': {
      const id = readSessionId(payload, ['conversation_id'])
      return id ? { key: 'conversation_id', id } : null
    }
    case 'amp':
    case 'command-code':
      return null
  }
}
