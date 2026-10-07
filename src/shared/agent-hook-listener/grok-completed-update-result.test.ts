import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readGrokCompletedUpdateResult } from './grok-completed-update-result'
import { extractGrokToolFields } from './providers/grok-tool-fields'

let home: string
let sessionDir: string
const sessionId = 'session-1'
const promptId = 'prompt-1'
const hook = { sessionId, promptId, cwd: '/workspace' }
function update(kind: string, fields: Record<string, unknown> = {}, session = sessionId) {
  return {
    method:
      kind === 'turn_completed' || kind === 'hook_execution'
        ? '_x.ai/session/update'
        : 'session/update',
    params: { sessionId: session, update: { sessionUpdate: kind, ...fields } }
  }
}
function assistant(text: string) {
  return update('agent_message_chunk', { content: { type: 'text', text } })
}
function completed(prompt = promptId) {
  return update('turn_completed', { prompt_id: prompt, stop_reason: 'refusal' })
}
function writeUpdates(rows: unknown[]) {
  writeFileSync(
    join(sessionDir, 'updates.jsonl'),
    `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`
  )
}

describe('Grok completed update result', () => {
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'orca-grok-completed-update-'))
    sessionDir = join(home, 'sessions', encodeURIComponent(hook.cwd), sessionId)
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(
      join(sessionDir, 'chat_history.jsonl'),
      `${JSON.stringify({ type: 'assistant', content: [] })}\n`
    )
  })
  afterEach(() => rmSync(home, { recursive: true, force: true }))

  it('recovers final assistant text from the completed provider turn', () => {
    writeUpdates([
      update('tool_call_update', { status: 'completed' }),
      assistant('Provider refused '),
      assistant('this request.'),
      completed(),
      update('hook_execution', { event_name: 'stop_failure', prompt_id: promptId })
    ])
    expect(readGrokCompletedUpdateResult(hook, home)).toBe('Provider refused this request.')
    expect(extractGrokToolFields('StopFailure', hook, home)).toEqual({
      lastAssistantMessage: 'Provider refused this request.'
    })
  })

  it('does not replace direct hook final text', () => {
    writeUpdates([assistant('streamed'), completed()])
    expect(
      extractGrokToolFields('StopFailure', { ...hook, lastAssistantMessage: 'direct' }, home)
    ).toEqual({ lastAssistantMessage: 'direct' })
  })

  it.each(['_x.ai/session_notification', 'x.ai/session_notification', 'x.ai/session/update'])(
    'accepts existing Grok completion dialect %s',
    (method) => {
      writeUpdates([
        assistant('Final reply'),
        update('response_completed'),
        update('hook_run_started'),
        update('available_commands_update'),
        { ...completed(), method }
      ])
      expect(readGrokCompletedUpdateResult(hook, home)).toBe('Final reply')
    }
  )

  it('uses an exact-turn provider result when completion carries it', () => {
    writeUpdates([
      update('turn_completed', {
        prompt_id: promptId,
        stop_reason: 'refusal',
        agent_result: 'Final result'
      })
    ])
    expect(readGrokCompletedUpdateResult(hook, home)).toBe('Final result')
  })

  it('uses exact-turn updates before a previous chat-history assistant response', () => {
    writeFileSync(
      join(sessionDir, 'chat_history.jsonl'),
      `${JSON.stringify({ type: 'assistant', content: 'Previous reply' })}\n`
    )
    writeUpdates([assistant('Final refusal'), completed()])
    expect(extractGrokToolFields('StopFailure', hook, home)).toEqual({
      lastAssistantMessage: 'Final refusal'
    })
  })

  it.each(
    [
      [assistant('older'), completed('other-prompt')],
      [assistant('unfinished')],
      [assistant('older'), completed(), update('user_message_chunk')],
      [assistant('older'), completed(), update('agent_thought_chunk')],
      [assistant('older'), completed(), update('tool_call')],
      [
        update(
          'agent_message_chunk',
          { content: { type: 'text', text: 'other session' } },
          'other-session'
        ),
        completed()
      ],
      [assistant('older'), completed(), update('tool_call_update', { content: 'tool result' })]
    ].map((rows) => ({ rows }))
  )('rejects unjoined or newer unfinished evidence %#', ({ rows }) => {
    writeUpdates(rows)
    expect(readGrokCompletedUpdateResult(hook, home)).toBeUndefined()
  })

  it('requires a safe session and a prompt identity', () => {
    writeUpdates([assistant('final'), completed()])
    expect(readGrokCompletedUpdateResult({ sessionId, cwd: hook.cwd }, home)).toBeUndefined()
    expect(
      readGrokCompletedUpdateResult({ ...hook, sessionId: '../session-1' }, home)
    ).toBeUndefined()
  })

  it('does not search older completion behind malformed tail data', () => {
    writeUpdates([assistant('older'), completed()])
    writeFileSync(join(sessionDir, 'updates.jsonl'), '{invalid}\n', { flag: 'a' })
    expect(readGrokCompletedUpdateResult(hook, home)).toBeUndefined()
  })

  it('discards an incomplete result at the scan budget', () => {
    writeUpdates([assistant('x'.repeat(300 * 1024)), completed()])
    expect(readGrokCompletedUpdateResult(hook, home)).toBeUndefined()
  })

  it('joins assistant chunks across reverse-scan blocks', () => {
    const text = 'x'.repeat(40 * 1024)
    writeUpdates([update('agent_thought_chunk'), assistant(text), assistant(text), completed()])
    expect(readGrokCompletedUpdateResult(hook, home)).toBe(text + text)
  })
})
