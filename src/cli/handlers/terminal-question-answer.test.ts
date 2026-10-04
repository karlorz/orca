import { describe, expect, it, vi } from 'vitest'
import { terminalQuestionAnswerHandler } from './terminal-question-answer'
import type { HandlerContext } from '../dispatch'
import { TERMINAL_QUESTION_ANSWER_RUNTIME_CAPABILITY } from '../../shared/protocol-version'

vi.mock('../format', () => ({ printResult: vi.fn() }))

function fixture(capabilities: string[] = [TERMINAL_QUESTION_ANSWER_RUNTIME_CAPABILITY]) {
  const call = vi.fn(async () => ({ ok: true, result: { answer: { accepted: true } } }))
  const getCliStatus = vi.fn(async () => ({ result: { runtime: { capabilities } } }))
  const context = {
    flags: new Map<string, string | boolean>([
      ['provider', 'grok'],
      ['session', 'session'],
      ['call', 'call'],
      ['choice', '2'],
      ['label-sha256', 'a'.repeat(64)]
    ]),
    client: { call, getCliStatus },
    json: true,
    cwd: '/workspace'
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The handler only uses these mocked client methods and flags.
  return { context: context as unknown as HandlerContext, call }
}

describe('terminal answer-question CLI', () => {
  it('passes exact call/index/label to one host RPC', async () => {
    const { context, call } = fixture()
    await terminalQuestionAnswerHandler(context)
    expect(call).toHaveBeenCalledExactlyOnceWith('terminal.answerQuestion', {
      provider: 'grok',
      session: 'session',
      callId: 'call',
      choice: 2,
      labelSha256: 'a'.repeat(64)
    })
  })
  it('refuses an older host without sending input', async () => {
    const { context, call } = fixture([])
    await expect(terminalQuestionAnswerHandler(context)).rejects.toMatchObject({
      code: 'question_answer_unavailable'
    })
    expect(call).not.toHaveBeenCalled()
  })
  it('passes exact batch answers without a first-question-only choice', async () => {
    const { context, call } = fixture()
    context.flags.delete('choice')
    context.flags.delete('label-sha256')
    context.flags.set(
      'answers',
      JSON.stringify([
        { questionIndex: 1, choices: [1, 3], labelSha256s: ['a'.repeat(64), 'b'.repeat(64)] }
      ])
    )
    await terminalQuestionAnswerHandler(context)
    expect(call).toHaveBeenCalledExactlyOnceWith('terminal.answerQuestion', {
      provider: 'grok',
      session: 'session',
      callId: 'call',
      answers: [
        { questionIndex: 1, choices: [1, 3], labelSha256s: ['a'.repeat(64), 'b'.repeat(64)] }
      ]
    })
  })
  it.each(['0', '10', '2x'])('refuses invalid choice %s', async (choice) => {
    const { context, call } = fixture()
    context.flags.set('choice', choice)
    await expect(terminalQuestionAnswerHandler(context)).rejects.toMatchObject({
      code: 'invalid_argument'
    })
    expect(call).not.toHaveBeenCalled()
  })
})
