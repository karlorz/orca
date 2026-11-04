import { parseHookEnvelope } from './hook-envelope'
import { readFirstString } from './interactive-tool'
import type { AgentHookSource } from '../agent-hook-relay'
import type { AgentHookEventPayload } from './listener-event'
import type { HookListenerState } from './listener-state'
import { normalizeClaudePromptId, normalizeGrokPromptId } from './listener-limits'
import { extractPromptText } from './prompt-fields'
import { hasExplicitUserPrompt } from './provider-event-routing'
import {
  isOpenCodeSharedServerPost,
  resolveOpenCodeSharedServerEnvelope,
  suppressOpenCodeSharedServerPost,
  trackOpenCodePaneLaunchToken
} from './opencode-session-registry'
import { isLateGrokSessionStart } from './grok-session-start-order'
import { readPaneProviderSession } from './pane-provider-session'
import type { AgentMainAgentStatus } from '../agent-status-types'

export type NormalizeHookPayloadOptions = {
  deferCompactOwnershipToClient?: boolean
  previousOpenCodeMainAgent?: AgentMainAgentStatus
  admitOpenCodeTui?: (
    identity: Pick<
      AgentHookEventPayload,
      'paneKey' | 'launchToken' | 'hookEventName' | 'hasExplicitPrompt'
    >
  ) => boolean | 'preserve-poster'
}

export type NormalizedHookPayloadStamp = {
  record: Record<string, unknown>
  hookPayloadRecord: Record<string, unknown>
  eventName: unknown
  providerSession: ReturnType<typeof readPaneProviderSession>
  extractedPrompt: ReturnType<typeof extractPromptText>
  paneKey: string
  tabId: string | undefined
  worktreeId: string | undefined
  launchToken: string | undefined
  providerPromptId: string | undefined
  compactTrigger: 'manual' | 'auto' | undefined
  previousStatus: ReturnType<HookListenerState['lastStatusByPaneKey']['get']>
}

export function resolveNormalizedHookPayloadStamp(
  state: HookListenerState,
  source: AgentHookSource,
  body: unknown,
  expectedEnv: string,
  options: NormalizeHookPayloadOptions = {}
): NormalizedHookPayloadStamp | null {
  const envelope = parseHookEnvelope(state, source, body, expectedEnv)
  if (!envelope) {
    return null
  }
  const {
    record,
    paneKey: stampedPaneKey,
    hookPayloadRecord,
    tabId: stampedTabId,
    worktreeId: stampedWorktreeId,
    launchToken: stampedLaunchToken
  } = envelope
  if (source === 'claude') {
    state.claudeUnconfirmedRestoredStatusPaneKeys.delete(stampedPaneKey)
  }
  const eventName =
    readFirstString(record, ['hook_event_name', 'hookEventName', 'hook_type', 'hookType']) ??
    hookPayloadRecord.hook_event_name ??
    hookPayloadRecord.hookEventName ??
    // Only jcode posts lifecycle under event; other providers may use that field for unrelated data.
    (source === 'jcode' ? hookPayloadRecord.event : undefined)
  const providerSession = readPaneProviderSession(state, source, stampedPaneKey, hookPayloadRecord)
  if (source === 'opencode' && record.opencodeTui === 1 && !providerSession) {
    return null
  }
  if (suppressOpenCodeSharedServerPost(state, source, record, providerSession?.id)) {
    return null
  }
  const extractedPrompt = extractPromptText(hookPayloadRecord)
  // A TUI's physical launch must pass the host fence before borrowing its creator's identity.
  const tuiAdmission =
    source === 'opencode' && record.opencodeTui === 1 && isOpenCodeSharedServerPost(source, record)
      ? options.admitOpenCodeTui?.({
          paneKey: stampedPaneKey,
          launchToken: stampedLaunchToken,
          hookEventName: typeof eventName === 'string' ? eventName : undefined,
          hasExplicitPrompt: hasExplicitUserPrompt(
            source,
            eventName,
            extractedPrompt,
            extractedPrompt.text
          )
        })
      : undefined
  if (tuiAdmission === false) {
    return null
  }
  // Rewrite frozen OpenCode1 server stamps before status/routing/fences use the wrong pane (#21359).
  const stamped = {
    paneKey: stampedPaneKey,
    tabId: stampedTabId,
    worktreeId: stampedWorktreeId,
    launchToken: stampedLaunchToken
  }
  const { paneKey, tabId, worktreeId, launchToken } =
    tuiAdmission === 'preserve-poster'
      ? stamped
      : resolveOpenCodeSharedServerEnvelope({
          state,
          source,
          stamped,
          sessionId: providerSession?.id,
          body: record
        })
  // Track only resolved tokens or stale shared-server stamps can poison the live pane cache.
  if (tuiAdmission !== 'preserve-poster') {
    trackOpenCodePaneLaunchToken(state, paneKey, launchToken)
  }
  const providerPromptId =
    source === 'claude'
      ? normalizeClaudePromptId(hookPayloadRecord.prompt_id)
      : source === 'grok'
        ? normalizeGrokPromptId(hookPayloadRecord.promptId ?? hookPayloadRecord.prompt_id)
        : undefined
  const compactTrigger =
    source === 'claude' &&
    (eventName === 'PreCompact' || eventName === 'PostCompact') &&
    (hookPayloadRecord.trigger === 'manual' || hookPayloadRecord.trigger === 'auto')
      ? hookPayloadRecord.trigger
      : undefined
  // Reject malformed Claude compacts without suppressing other providers' normalizers.
  if (
    source === 'claude' &&
    (eventName === 'PreCompact' || eventName === 'PostCompact') &&
    compactTrigger === undefined
  ) {
    return null
  }
  const previousStatus = state.lastStatusByPaneKey.get(paneKey)
  if (
    isLateGrokSessionStart(previousStatus, {
      source,
      hookEventName: typeof eventName === 'string' ? eventName : undefined,
      paneKey,
      tabId,
      worktreeId,
      connectionId: null,
      launchToken,
      providerSession: providerSession ?? undefined
    })
  ) {
    return null
  }
  return {
    record,
    hookPayloadRecord,
    eventName,
    providerSession,
    extractedPrompt,
    paneKey,
    tabId,
    worktreeId,
    launchToken,
    providerPromptId,
    compactTrigger,
    previousStatus
  }
}
