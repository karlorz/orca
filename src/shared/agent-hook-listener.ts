import { readGrokAutomationAssistantResult } from './automation-assistant-result'
import { readHookAgentProcess } from './agent-process-presence'
import { resolveAgentStatusIdentity } from './agent-status-identity'
import { sameAgentStatusTerminalOwner } from './agent-status-terminal-owner'
import { normalizeAgentStatusPayload } from './agent-status-types'
import type { AgentHookSource } from './agent-hook-relay'
import {
  canAcceptClaudeCompactCompletion,
  isClaudeCompactCompletionConsumed,
  markClaudeCompactCompletionConsumed
} from './claude-compact-completion'
import { readFirstString } from './agent-hook-listener/interactive-tool'
import type { AgentHookEventPayload } from './agent-hook-listener/listener-event'
import type { HookListenerState } from './agent-hook-listener/listener-state'
import { normalizeProviderEvent } from './agent-hook-listener/provider-dispatch'
import { hasExplicitUserPrompt } from './agent-hook-listener/provider-event-routing'
import { hasExplicitAmpPrompt } from './agent-hook-listener/providers/amp-events'
import { claudeRowHasUnlistedLiveWork } from './agent-hook-listener/providers/claude-pane-hold-evidence'
import { readString } from './agent-hook-listener/tool-input-preview'
import { CLAUDE_EXIT_SESSION_END_REASONS } from './agent-hook-listener/claude-exit-session-end-reasons'
import { isHookFromInheritedAgent } from './agent-hook-listener/hook-owner-precedence'
import {
  resolveNormalizedHookPayloadStamp,
  type NormalizeHookPayloadOptions
} from './agent-hook-listener/hook-payload-stamp'

export function normalizeHookPayload(
  state: HookListenerState,
  source: AgentHookSource,
  body: unknown,
  expectedEnv: string,
  options: NormalizeHookPayloadOptions = {}
): AgentHookEventPayload | null {
  const stamp = resolveNormalizedHookPayloadStamp(state, source, body, expectedEnv, options)
  if (!stamp) {
    return null
  }
  const {
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
  } = stamp
  const agentProcess = readHookAgentProcess(source, record.agentProcess)
  const previousReceivedAt =
    previousStatus &&
    'receivedAt' in previousStatus &&
    typeof previousStatus.receivedAt === 'number'
      ? previousStatus.receivedAt
      : previousStatus?.hostEvidenceObservedAt
  // Reject before provider folds mutate the pane's prompt, tool and child caches.
  if (
    previousStatus &&
    previousReceivedAt !== undefined &&
    sameAgentStatusTerminalOwner(
      { connectionId: previousStatus.connectionId ?? null, worktreeId: previousStatus.worktreeId },
      { connectionId: null, worktreeId }
    ) &&
    resolveAgentStatusIdentity({
      existing: {
        agentType: previousStatus.payload.agentType,
        state: previousStatus.payload.state,
        updatedAt: previousReceivedAt,
        restoredUnconfirmed: previousStatus.restoredUnconfirmed,
        agentPresence: previousStatus.providerSessionOnly ? undefined : previousStatus.agentPresence
      },
      incoming: source,
      incomingProcess: agentProcess,
      incomingSession: providerSession?.id,
      now: Date.now()
    }).inheritedFromActivePane
  ) {
    return null
  }
  // Reject before provider folds mutate the pane's prompt, tool and child caches.
  if (isHookFromInheritedAgent(previousStatus, source, worktreeId)) {
    return null
  }
  // Why: only a MANUAL completion claims anything, so only it may write compact-scoped state. An
  // auto compact runs inside a turn that resumes and emits its own Stop; running the ownership
  // guard for it would burn the pane's consumed-compact slot on an event that maps to nothing.
  const isCompactCompletion =
    source === 'claude' && eventName === 'PostCompact' && compactTrigger === 'manual'
  if (isCompactCompletion) {
    // Relay restarts/evictions lose ownership evidence; defer the guard to client ingest, which owns pane retirement and hydrated rows.
    if (options.deferCompactOwnershipToClient !== true) {
      if (
        isClaudeCompactCompletionConsumed(
          state.claudeConsumedCompactPromptIdByPaneKey,
          paneKey,
          providerPromptId
        ) ||
        !canAcceptClaudeCompactCompletion(previousStatus, {
          source,
          connectionId: null,
          providerPromptId,
          providerSession: providerSession ?? undefined
        })
      ) {
        return null
      }
      markClaudeCompactCompletionConsumed(
        state.claudeConsumedCompactPromptIdByPaneKey,
        paneKey,
        providerPromptId
      )
    }
    // Compacts have no prompt; retain the summarized turn's label.
    if (previousStatus?.payload.prompt && !state.lastPromptByPaneKey.has(paneKey)) {
      state.lastPromptByPaneKey.set(paneKey, previousStatus.payload.prompt)
    }
  }

  const agentPresence = agentProcess
    ? { agent: source, process: agentProcess, sessionOwner: true as const }
    : undefined
  const sessionEndReason = readString(hookPayloadRecord, 'reason')
  if (
    eventName === 'SessionEnd' &&
    agentPresence &&
    !readString(hookPayloadRecord, 'agent_id') &&
    // Only known process-exit reasons prove session death; /clear, /resume and unknown reasons do not.
    sessionEndReason !== undefined &&
    CLAUDE_EXIT_SESSION_END_REASONS.has(sessionEndReason)
  ) {
    const payload =
      previousStatus?.payload ??
      normalizeAgentStatusPayload({ state: 'done', prompt: '', agentType: source })
    if (!payload) {
      return null
    }
    return {
      paneKey,
      source,
      launchToken,
      tabId,
      worktreeId,
      connectionId: null,
      providerSession: providerSession ?? undefined,
      hookEventName: 'SessionEnd',
      agentPresence: { ...agentPresence, ended: true as const },
      payload
    }
  }

  const promptText = extractedPrompt.text
  const dispatched = normalizeProviderEvent({
    state,
    source,
    eventName,
    promptText,
    paneKey,
    hookPayload: hookPayloadRecord,
    envelope: record,
    extractedPrompt,
    previousOpenCodeMainAgent: options.previousOpenCodeMainAgent,
    hasProviderSession: providerSession !== null
  })
  const { providerSessionOnly } = dispatched
  // A transcript session_start carries resume identity while idle; receivers discard the placeholder row.
  const transportPayload =
    dispatched.payload ??
    (providerSessionOnly
      ? normalizeAgentStatusPayload({ state: 'done', prompt: '', agentType: source })
      : null)
  const restoredUnconfirmed =
    source === 'claude' && state.claudeUnconfirmedRestoredStatusPaneKeys.delete(paneKey)
  if (!transportPayload) {
    return null
  }
  const grokActiveTurn = source === 'grok' ? state.grokActiveTurnByPaneKey.get(paneKey) : undefined

  return {
    ...(source === 'grok' && typeof hookPayloadRecord.timestamp === 'string'
      ? { grokEventAt: Date.parse(hookPayloadRecord.timestamp) }
      : {}),
    paneKey,
    source,
    agentPresence,
    launchToken,
    tabId,
    worktreeId,
    // Normalization is transport-agnostic; only ingestRemote knows the mux identity to stamp.
    connectionId: null,
    ...(restoredUnconfirmed ? { restoredUnconfirmed: true } : {}),
    hasExplicitPrompt:
      source === 'amp'
        ? hasExplicitAmpPrompt(eventName, promptText, hookPayloadRecord)
          ? true
          : undefined
        : hasExplicitUserPrompt(
            source,
            dispatched.eventName,
            extractedPrompt,
            dispatched.resolvedPromptText,
            dispatched.hasTranscriptPromptEvidence
          ),
    promptInteractionKey: dispatched.promptInteractionKey,
    hookEventName: typeof dispatched.eventName === 'string' ? dispatched.eventName : undefined,
    providerPromptId:
      source === 'grok' ? (grokActiveTurn?.promptId ?? providerPromptId) : providerPromptId,
    grokPromptBoundary: grokActiveTurn ? true : undefined,
    compactTrigger,
    toolUseId: readFirstString(hookPayloadRecord, ['tool_use_id', 'toolUseId']),
    toolAgentId: readFirstString(hookPayloadRecord, ['agent_id', 'agentId']),
    teammateName:
      source === 'claude' && eventName === 'TeammateIdle'
        ? readString(hookPayloadRecord, 'teammate_name')
        : undefined,
    toolAgentType: readString(hookPayloadRecord, 'agent_type'),
    ...(source === 'claude'
      ? {
          claudeRunningNonAgentTask: claudeRowHasUnlistedLiveWork(state, paneKey)
        }
      : {}),
    ...(providerSession ? { providerSession } : {}),
    ...(providerSessionOnly ? { providerSessionOnly: true } : {}),
    ...dispatched.hostTurnSignals,
    automationAssistantResult:
      source === 'grok' && (transportPayload.mainAgent?.state ?? transportPayload.state) === 'done'
        ? readGrokAutomationAssistantResult(hookPayloadRecord, record, grokActiveTurn)
        : undefined,
    payload: transportPayload
  }
}
