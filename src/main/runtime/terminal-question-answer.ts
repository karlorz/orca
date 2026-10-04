import { sameGrokSessionBinding, type GrokSessionBinding } from '../../shared/grok-session-binding'
import type { RuntimeTerminalSend } from '../../shared/runtime-types'
import {
  normalizeGrokQuestionAnswers,
  type GrokQuestionAnswerItem,
  type VerifiedGrokQuestion
} from './grok-question-answer-proof'

export type QuestionAnswerRequest = {
  session: string
  callId: string
  choice?: number
  labelSha256?: string
  answers?: GrokQuestionAnswerItem[]
}

export type QuestionScreenContent = {
  question: string
  optionLabels: readonly string[]
}

type AnswerAuthority = {
  resolve(): GrokSessionBinding
  verify(
    binding: GrokSessionBinding,
    content?: QuestionScreenContent
  ): VerifiedGrokQuestion[] | Promise<VerifiedGrokQuestion[]>
  send(
    binding: GrokSessionBinding,
    text: string,
    beforeWrite: (ptyId: string) => void | Promise<void>
  ): Promise<RuntimeTerminalSend>
}

function keystrokesFor(
  questions: VerifiedGrokQuestion[],
  answers: GrokQuestionAnswerItem[]
): { text: string; question: VerifiedGrokQuestion }[] {
  const steps: { text: string; question: VerifiedGrokQuestion }[] = []
  for (let index = 0; index < answers.length; index += 1) {
    const question = questions[index]
    const answer = answers[index]
    const last = index === answers.length - 1
    if (question.multiSelect) {
      steps.push({ text: '\u0015', question }, { text: 'g', question })
      const lastSelected = Math.max(...answer.choices)
      for (let option = 1; option <= lastSelected; option += 1) {
        if (answer.choices.includes(option)) {
          steps.push({ text: ' ', question })
        }
        if (option < lastSelected) {
          steps.push({ text: 'j', question })
        }
      }
      steps.push({ text: last ? '\r' : 'l', question })
      continue
    }
    // Why: Ctrl+U leaves the Other row; the digit is the absolute option shortcut.
    // On a later question the digit also advances; the last digit submits.
    steps.push({ text: '\u0015', question }, { text: String(answer.choices[0]), question })
  }
  return steps
}

function screenContent(question: VerifiedGrokQuestion): QuestionScreenContent {
  return {
    question: question.text,
    optionLabels: question.options.map((option) => option.label)
  }
}

export class TerminalQuestionAnswer {
  private readonly consumed = new Set<string>()

  async answer(request: QuestionAnswerRequest, authority: AnswerAuthority) {
    const answers = normalizeGrokQuestionAnswers(request)
    const binding = authority.resolve()
    if (binding.executionHostId !== 'local') {
      throw new Error('question_host_unverifiable')
    }
    const key = JSON.stringify([
      binding.runtimeId,
      binding.incarnationId,
      request.session,
      request.callId
    ])
    if (this.consumed.has(key)) {
      throw new Error('question_already_submitted')
    }
    // Why: refuse new writes rather than evicting consumed calls and enabling replay.
    if (this.consumed.size >= 4096) {
      throw new Error('question_answer_capacity')
    }
    const verify = async (ptyId: string, content?: QuestionScreenContent) => {
      const questions = await authority.verify(binding, content)
      if (ptyId !== binding.ptyId || !sameGrokSessionBinding(authority.resolve(), binding)) {
        throw new Error('session_binding_changed')
      }
      return questions
    }
    this.consumed.add(key)
    const verified = await verify(binding.ptyId, undefined)
    if (verified.length !== answers.length) {
      throw new Error('question_call_unverifiable')
    }
    await verify(binding.ptyId, screenContent(verified[0]))
    let bytesWritten = 0
    for (const step of keystrokesFor(verified, answers)) {
      const send = await authority.send(binding, step.text, async (ptyId) => {
        await verify(ptyId, screenContent(step.question))
      })
      if (!send.accepted || send.bytesWritten !== 1) {
        throw new Error('question_delivery_unconfirmed')
      }
      bytesWritten += send.bytesWritten
    }
    return {
      binding,
      callId: request.callId,
      choice: answers[0].choices[0],
      accepted: true,
      bytesWritten
    }
  }
}
