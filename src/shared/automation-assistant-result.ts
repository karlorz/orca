import type { AutomationAssistantResult } from './automation-assistant-result-types'
import { isSafeGrokSessionId } from './grok-session-paths'
import { normalizeGrokPromptId } from './agent-hook-listener/listener-limits'
import { readGrokCompletedUpdateResult } from './agent-hook-listener/grok-completed-update-result'
import {
  readGrokHomeEnvelope,
  readGrokSessionMetadata
} from './agent-hook-listener/grok-result-discovery'

export const AUTOMATION_ASSISTANT_RESULT_MAX_CHARS = 256 * 1024

export function boundedAutomationAssistantResult(
  value: unknown
): AutomationAssistantResult | undefined {
  if (
    !value ||
    typeof value !== 'object' ||
    !('providerSessionId' in value) ||
    typeof value.providerSessionId !== 'string' ||
    !isSafeGrokSessionId(value.providerSessionId) ||
    !('providerPromptId' in value) ||
    typeof value.providerPromptId !== 'string' ||
    !normalizeGrokPromptId(value.providerPromptId) ||
    !('content' in value) ||
    !('truncated' in value) ||
    typeof value.content !== 'string' ||
    typeof value.truncated !== 'boolean' ||
    !value.content.trim()
  ) {
    return undefined
  }
  return {
    providerSessionId: value.providerSessionId,
    providerPromptId: value.providerPromptId,
    content: value.content.slice(0, AUTOMATION_ASSISTANT_RESULT_MAX_CHARS),
    truncated: value.truncated || value.content.length > AUTOMATION_ASSISTANT_RESULT_MAX_CHARS
  }
}

export function readGrokAutomationAssistantResult(
  record: Record<string, unknown>,
  envelope: Record<string, unknown>,
  activeTurn?: { sessionId?: string; promptId?: string }
): AutomationAssistantResult | undefined {
  const home = readGrokHomeEnvelope(envelope)
  const metadata = readGrokSessionMetadata(record, home)
  if (
    record.promptId === undefined &&
    record.prompt_id === undefined &&
    activeTurn?.sessionId === metadata?.sessionId
  ) {
    record = { ...record, promptId: activeTurn?.promptId }
  }
  const prompt = normalizeGrokPromptId(record.promptId ?? record.prompt_id)
  if (!metadata || !prompt) {
    return undefined
  }
  const direct = record.lastAssistantMessage ?? record.last_assistant_message
  const text =
    typeof direct === 'string' && direct.trim()
      ? direct
      : readGrokCompletedUpdateResult(record, home)
  return text
    ? boundedAutomationAssistantResult({
        content: text,
        truncated: false,
        providerSessionId: metadata.sessionId,
        providerPromptId: prompt
      })
    : undefined
}
