import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { verifyGrokQuestionAnswer } from './grok-question-answer-proof'

const directories: string[] = []
afterEach(() => {
  for (const dir of directories.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'orca-question-proof-'))
  directories.push(dir)
  const args = {
    historyPath: join(dir, 'chat_history.jsonl'),
    boundaryAt: 1000,
    callId: 'call',
    choice: 2,
    labelSha256: createHash('sha256').update('Beta (Recommended)').digest('hex')
  }
  const question = {
    question: 'Pick one',
    options: [{ label: 'Alpha' }, { label: 'Beta (Recommended)' }]
  }
  const history = [
    {
      type: 'assistant',
      tool_calls: [
        {
          id: 'call',
          name: 'ask_user_question',
          arguments: JSON.stringify({ questions: [question] })
        }
      ]
    }
  ]
  const events = [
    { type: 'tool_started', tool_name: 'ask_user_question', ts: new Date(2000).toISOString() }
  ]
  const save = () => {
    writeFileSync(args.historyPath, `${history.map((row) => JSON.stringify(row)).join('\n')}\n`)
    writeFileSync(
      join(dir, 'events.jsonl'),
      `${events.map((row) => JSON.stringify(row)).join('\n')}\n`
    )
  }
  save()
  return { args, dir, question, history, events, save }
}
describe('Grok question answer proof', () => {
  it('accepts the exact open single-choice call and original label hash', () => {
    expect(() => verifyGrokQuestionAnswer(fixture().args)).not.toThrow()
  })
  it.each(['call', 'label', 'index', 'boundary'])('refuses changed %s', (kind) => {
    const { args } = fixture()
    if (kind === 'call') {
      args.callId = 'other'
    }
    if (kind === 'label') {
      args.labelSha256 = 'a'.repeat(64)
    }
    if (kind === 'index') {
      args.choice = 9
    }
    if (kind === 'boundary') {
      args.boundaryAt = 3000
    }
    expect(() => verifyGrokQuestionAnswer(args)).toThrow()
  })
  it.each(['completed', 'turn-ended', 'duplicate-open'])('refuses %s', (kind) => {
    const { args, events, save } = fixture()
    events.push({
      type:
        kind === 'completed'
          ? 'tool_completed'
          : kind === 'turn-ended'
            ? 'turn_ended'
            : 'tool_started',
      tool_name: 'ask_user_question',
      ts: new Date(2500).toISOString()
    })
    save()
    expect(() => verifyGrokQuestionAnswer(args)).toThrow('question_not_waiting')
  })
  it('refuses a malformed question payload', () => {
    const { args, history, save } = fixture()
    history[0].tool_calls[0].arguments = JSON.stringify({ questions: [{}] })
    save()
    expect(() => verifyGrokQuestionAnswer(args)).toThrow()
  })
  it('accepts multi-select when every original label hash is present', () => {
    const { args, history, question, save } = fixture()
    history[0].tool_calls[0].arguments = JSON.stringify({
      questions: [{ ...question, multi_select: true }]
    })
    save()
    expect(() =>
      verifyGrokQuestionAnswer({
        ...args,
        choice: undefined,
        labelSha256: undefined,
        answers: [
          {
            questionIndex: 1,
            choices: [2],
            labelSha256s: [args.labelSha256]
          }
        ]
      })
    ).not.toThrow()
  })
  it('refuses answering only the first question of a batch', () => {
    const { args, history, question, save } = fixture()
    history[0].tool_calls[0].arguments = JSON.stringify({ questions: [question, question] })
    save()
    expect(() => verifyGrokQuestionAnswer(args)).toThrow('question_call_unverifiable')
  })
  it('refuses history completion before the event flush', () => {
    const { args } = fixture()
    writeFileSync(
      args.historyPath,
      `${JSON.stringify({ type: 'tool_result', tool_call_id: 'call' })}\n`,
      {
        flag: 'a'
      }
    )
    expect(() => verifyGrokQuestionAnswer(args)).toThrow('question_already_completed')
  })
  it('refuses a newer history question while the earlier call is still unresolved', () => {
    const { args, history, save } = fixture()
    history.push({ ...history[0], tool_calls: [{ ...history[0].tool_calls[0], id: 'new-call' }] })
    args.callId = 'new-call'
    save()
    expect(() => verifyGrokQuestionAnswer(args)).toThrow('question_call_unverifiable')
  })
  it('refuses partial JSONL and symlinked evidence', () => {
    const { args, dir } = fixture()
    writeFileSync(join(dir, 'events.jsonl'), '{}', { flag: 'a' })
    expect(() => verifyGrokQuestionAnswer(args)).toThrow()
    const link = join(dir, 'linked.jsonl')
    symlinkSync(args.historyPath, link)
    expect(() => verifyGrokQuestionAnswer({ ...args, historyPath: link })).toThrow()
  })
})
