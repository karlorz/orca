import { normalizeAgentStatusPayload } from '../agent-status-types'
import { readGrokAutomationAssistantResult } from '../automation-assistant-result'
import type { AgentHookEventPayload } from './listener-event'
import { parseHookBodyPayloadRecord, readGrokHomeEnvelope } from './grok-result-discovery'
import { extractGrokToolFields } from './providers/grok-tool-fields'

export function isGrokAutomationResultPending(
  event: Pick<
    AgentHookEventPayload,
    'payload' | 'providerPromptId' | 'providerSession' | 'automationAssistantResult'
  >
): boolean {
  return (
    event.payload.agentType === 'grok' &&
    (event.payload.mainAgent?.state ?? event.payload.state) === 'done' &&
    Boolean(event.providerPromptId && event.providerSession?.id) &&
    !event.automationAssistantResult
  )
}

export function shouldClearAssistantMessageRetry(event: AgentHookEventPayload): boolean {
  return (
    event.payload.state !== 'done' ||
    Boolean(
      event.payload.lastAssistantMessage &&
      event.payload.lastAssistantMessageIsToolOutput !== true &&
      !isGrokAutomationResultPending(event)
    )
  )
}

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
  const automationAssistantResult = readGrokAutomationAssistantResult(
    record,
    { grokHome },
    { sessionId: original.providerSession?.id, promptId: original.providerPromptId }
  )
  const result = automationAssistantResult
    ? { lastAssistantMessage: automationAssistantResult.content }
    : extractGrokToolFields(original.hookEventName, record, grokHome)
  if (!result.lastAssistantMessage || result.lastAssistantMessageIsToolOutput === true) {
    return null
  }
  const payload = normalizeAgentStatusPayload({
    ...current.payload,
    lastAssistantMessage: result.lastAssistantMessage,
    lastAssistantMessageIsToolOutput: false
  })
  if (!payload) {
    return null
  }
  return {
    ...current,
    automationAssistantResult,
    payload: { ...payload, lastAssistantMessageIsToolOutput: false }
  }
}
