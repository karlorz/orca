import type { AgentHookEventPayload } from './listener-event'
import { parseHookBodyPayloadRecord, readGrokHomeEnvelope } from './grok-result-discovery'
import { extractGrokToolFields } from './providers/grok-tool-fields'

export function recoverGrokHookResult(
  body: unknown,
  original: AgentHookEventPayload,
  current: AgentHookEventPayload
): AgentHookEventPayload | null {
  const record = parseHookBodyPayloadRecord(body)
  if (!record) {
    return null
  }
  const grokHome =
    body && typeof body === 'object' && 'grokHome' in body
      ? readGrokHomeEnvelope({ grokHome: body.grokHome })
      : undefined
  const result = extractGrokToolFields(original.hookEventName, record, grokHome)
  if (!result.lastAssistantMessage || result.lastAssistantMessageIsToolOutput === true) {
    return null
  }
  return {
    ...current,
    payload: {
      ...current.payload,
      lastAssistantMessage: result.lastAssistantMessage,
      lastAssistantMessageIsToolOutput: false
    }
  }
}
