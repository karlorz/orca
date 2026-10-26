import {
  hasUnsafeProviderSessionIdChars,
  normalizeSessionId,
  readPathFromKeys
} from './agent-provider-session-extract'
import type { AgentStatusCacheIdentity, RefusedPaneResume } from './agent-status-ipc-payload'
import type { AgentStatusState } from './agent-status-types'
import type { AgentMainAgentStatus } from './main-agent-status'
import type { TuiAgent } from './tui-agent'

export const RESUMABLE_TUI_AGENTS = [
  'claude',
  'codebuddy',
  'codex',
  'qoder',
  'qoder-cn',
  'qwen-code',
  'gemini',
  'antigravity',
  'opencode',
  'opencode2',
  'pi',
  'mimo-code',
  'droid',
  'grok',
  'devin',
  'omp',
  'prime-agent',
  'copilot',
  'cursor',
  'kimi',
  'muse',
  'zcode',
  'dsh',
  'jcode',
  'kiro',
  'hermes'
] as const satisfies readonly TuiAgent[]

export type ResumableTuiAgent = (typeof RESUMABLE_TUI_AGENTS)[number]

export type AgentProviderSessionKey = 'session_id' | 'conversation_id'

export type AgentProviderSessionMetadata = {
  key: AgentProviderSessionKey
  id: string
  /** Prefer hook-reported transcript paths: recent Claude filenames differ from session_id. Claude/Codex still resume by ID; Pi uses session_file as its --session locator. */
  transcriptPath?: string
  /** Folder the agent ran in; resume runs there, not the pane's start folder (#16960). */
  cwd?: string
}

export type SleepingAgentLaunchConfig = {
  agentCommand?: string
  agentArgs: string
  agentEnv: Record<string, string>
  ompResumeFilePath?: string
}

export type SleepingAgentSessionRecord = {
  paneKey: string
  tabId?: string
  worktreeId: string
  agent: ResumableTuiAgent
  providerSession: AgentProviderSessionMetadata
  prompt: string
  state: AgentStatusState
  capturedAt: number
  updatedAt: number
  terminalTitle?: string
  lastAssistantMessage?: string
  interrupted?: boolean
  /** The main agent's own status when captured, copied with `interrupted` by `agentVerdictFields`;
   *  read the verdict through `agentMainAgentVerdict`. */
  mainAgent?: AgentMainAgentStatus
  connectionId?: string | null
  launchConfig?: SleepingAgentLaunchConfig
  /** Worktree-sleep/legacy records open fresh tabs on activation. quit/live records belong to restored panes; only their cold-restore path consumes them to avoid duplicating warm sessions (#5232). */
  origin?: 'worktree-sleep' | 'quit' | 'live'
  /** Explicit-sleep finished panes resume only when their own tab opens; mobile wake must not mount/respawn every slept tab (#11598). */
  restoreOnTabOpenOnly?: boolean
}

/** A record of a slept pane (worktree sleep, or a legacy record); 'quit'/'live' resume a running agent. */
export function isPaneSleepRecord(record: Pick<SleepingAgentSessionRecord, 'origin'>): boolean {
  return record.origin === undefined || record.origin === 'worktree-sleep'
}

/** Only host-wake sleep records count: live/quit panes restore themselves, and tab-open-only panes wait for their tab. */
export function hasSleptAgentToWake(
  records: Record<string, SleepingAgentSessionRecord> | undefined,
  worktreeId: string
): boolean {
  return Object.values(records ?? {}).some(
    (record) =>
      record.worktreeId === worktreeId &&
      isPaneSleepRecord(record) &&
      record.restoreOnTabOpenOnly !== true
  )
}

const RESUMABLE_TUI_AGENT_SET: ReadonlySet<string> = new Set(RESUMABLE_TUI_AGENTS)

export function isResumableTuiAgent(value: unknown): value is ResumableTuiAgent {
  return typeof value === 'string' && RESUMABLE_TUI_AGENT_SET.has(value)
}

export function normalizeAgentProviderSession(raw: unknown): AgentProviderSessionMetadata | null {
  if (typeof raw !== 'object' || raw === null) {
    return null
  }
  const record = raw as Record<string, unknown>
  const key = record.key
  if (key !== 'session_id' && key !== 'conversation_id') {
    return null
  }
  const id = normalizeSessionId(record.id)
  if (!id) {
    return null
  }
  // Persisted/relay paths cross trust boundaries too; reject controls as for hook paths.
  const transcriptPath = readPathFromKeys(record, ['transcriptPath'])
  const cwd = readPathFromKeys(record, ['cwd'])
  return {
    key,
    id,
    ...(transcriptPath ? { transcriptPath } : {}),
    ...(cwd ? { cwd } : {})
  }
}

/** Older hosts' strict ensureAgentSession schema rejects the newer `cwd` field. */
export function agentProviderSessionForEnsure(
  providerSession: AgentProviderSessionMetadata
): AgentProviderSessionMetadata {
  const { cwd: _cwd, ...identity } = providerSession
  return identity
}

/** Compare the provider-owned values that identify the CLI resume target.
 *  Pi-family transcript resumes use file identity; other agents use provider ids. */
export function agentProviderSessionsEqual(
  agent: string | undefined,
  left: AgentProviderSessionMetadata | undefined,
  right: AgentProviderSessionMetadata | undefined
): boolean {
  if (left === undefined || right === undefined) {
    return left === right
  }
  return (
    left.key === right.key &&
    left.id === right.id &&
    ((agent !== 'pi' && agent !== 'prime-agent') || left.transcriptPath === right.transcriptPath)
  )
}

/** Build resume metadata from a persisted session id. Pi/Prime need a transcript path. */
export function providerSessionMetadataForAgentResume(
  agent: ResumableTuiAgent,
  sessionId: string,
  transcriptPath?: string
): AgentProviderSessionMetadata | null {
  const id = normalizeSessionId(sessionId)
  if (!id) {
    return null
  }
  if (agent === 'antigravity') {
    return { key: 'conversation_id', id }
  }
  if (agent === 'pi' || agent === 'prime-agent') {
    const path = transcriptPath?.trim()
    return path && !hasUnsafeProviderSessionIdChars(path)
      ? { key: 'session_id', id, transcriptPath: path }
      : null
  }
  return { key: 'session_id', id }
}

// Re-exported so existing call sites keep one import path.
export {
  extractAgentProviderSession,
  hasUnsafeProviderSessionIdChars,
  readPathFromKeys
} from './agent-provider-session-extract'
// Re-exported so the 18 existing call sites keep one import path.
export { getAgentForkArgv, getAgentResumeArgv } from './agent-resume-argv'

/** A host home check for this exact saved continuation, not a terminal writer claim. */
export type SavedResumeDecision = {
  agent: string
  providerSession: AgentProviderSessionMetadata
  verdict: 'admitted' | 'chat-home' | 'chat-writing' | 'unverifiable'
}

/** Effective facts of a terminal launch; a refused shell carries no rejected agent metadata. */
export type TerminalLaunchResult = {
  savedResumeDecision?: SavedResumeDecision
  agentResumeUnavailable?: true
  agentResumeRefused?: 'chat-home' | 'chat-writing' | 'unverifiable'
  refusedResume?: RefusedPaneResume
  launchConfig?: SleepingAgentLaunchConfig
  launchAgent?: TuiAgent
  launchToken?: string
  resumeProviderSession?: AgentProviderSessionMetadata
}

/** Runtime-only source shared by copies of one saved startup. Never persisted or sent to a host. */
export type SavedResumeStartupSource = {
  cancelled: boolean
  record?: SleepingAgentSessionRecord
  expectedStatus?: AgentStatusCacheIdentity
}

/** Forward only effective launch facts through each existing terminal envelope. */
export function terminalLaunchFacts(result: TerminalLaunchResult): TerminalLaunchResult {
  return {
    ...(result.savedResumeDecision ? { savedResumeDecision: result.savedResumeDecision } : {}),
    ...(result.agentResumeUnavailable
      ? { agentResumeUnavailable: result.agentResumeUnavailable }
      : {}),
    ...(result.agentResumeRefused ? { agentResumeRefused: result.agentResumeRefused } : {}),
    ...(result.refusedResume ? { refusedResume: result.refusedResume } : {}),
    ...(result.launchConfig ? { launchConfig: result.launchConfig } : {}),
    ...(result.launchAgent ? { launchAgent: result.launchAgent } : {}),
    ...(result.launchToken ? { launchToken: result.launchToken } : {}),
    ...(result.resumeProviderSession ? { resumeProviderSession: result.resumeProviderSession } : {})
  }
}
