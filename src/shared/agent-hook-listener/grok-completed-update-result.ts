import { dirname, join } from 'node:path'
import { getGrokChatHistoryPath, readGrokSessionMetadata } from './grok-result-discovery'
import { normalizeGrokPromptId } from './listener-limits'
import { parseAgentHookJson } from './request-body'
import { scanFileRegionsBackward } from './reverse-file-region-scan'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isResultMetadata(kind: unknown): boolean {
  return (
    kind === 'hook_execution' ||
    kind === 'hook_run_started' ||
    kind === 'response_completed' ||
    kind === 'available_commands_update'
  )
}

export function readGrokCompletedUpdateResult(
  hookPayload: Record<string, unknown>,
  grokHome?: string
): string | undefined {
  const metadata = readGrokSessionMetadata(hookPayload, grokHome)
  const promptId = normalizeGrokPromptId(hookPayload.promptId ?? hookPayload.prompt_id)
  if (!metadata || !promptId) {
    return undefined
  }
  const historyPath = getGrokChatHistoryPath(hookPayload, grokHome)
  if (!historyPath) {
    return undefined
  }
  const chunks: string[] = []
  let sawCompletion = false
  const result = scanFileRegionsBackward(
    join(dirname(historyPath), 'updates.jsonl'),
    { chunkBytes: 64 * 1024, maxScanBytes: 256 * 1024 },
    (region, position): string | null | undefined => {
      const lines = region.toString('utf8').split('\n')
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index].trim()
        if (!line) {
          continue
        }
        let record: unknown
        try {
          record = parseAgentHookJson(line)
        } catch {
          return null
        }
        if (!isRecord(record) || !isRecord(record.params)) {
          continue
        }
        const params = record.params
        if (params.sessionId !== metadata.sessionId || !isRecord(params.update)) {
          return null
        }
        const update = params.update
        const kind = update.sessionUpdate
        if (!sawCompletion) {
          if (kind !== 'turn_completed') {
            if (!isResultMetadata(kind)) {
              return null
            }
            continue
          }
          const method = typeof record.method === 'string' ? record.method.replace(/^_/, '') : ''
          if (
            !['x.ai/session/update', 'x.ai/session_notification'].includes(method) ||
            update.prompt_id !== promptId ||
            typeof update.stop_reason !== 'string'
          ) {
            return null
          }
          if (typeof update.agent_result === 'string' && update.agent_result.trim()) {
            return update.agent_result.trim()
          }
          sawCompletion = true
          continue
        }
        if (kind === 'agent_message_chunk') {
          if (
            record.method !== 'session/update' ||
            !isRecord(update.content) ||
            update.content.type !== 'text' ||
            typeof update.content.text !== 'string'
          ) {
            return null
          }
          chunks.push(update.content.text)
        } else if (!isResultMetadata(kind)) {
          return chunks.toReversed().join('').trim() || null
        }
      }
      return position === 0 ? chunks.toReversed().join('').trim() || null : undefined
    }
  )
  return result ?? undefined
}
