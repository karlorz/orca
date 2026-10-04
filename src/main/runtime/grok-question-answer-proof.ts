import { createHash } from 'node:crypto'
import { closeSync, fstatSync, openSync, readSync, constants } from 'node:fs'
import { dirname, join } from 'node:path'
import { z } from 'zod'

const TAIL_BYTES = 1024 * 1024
const RecordSchema = z.record(z.string(), z.unknown())
const CallSchema = z.object({ id: z.string(), name: z.string(), arguments: z.unknown() })
const QuestionSchema = z.object({
  questions: z
    .array(
      z.object({
        question: z.string().min(1),
        multi_select: z.boolean().optional(),
        multiSelect: z.boolean().optional(),
        options: z
          .array(z.object({ label: z.string().min(1) }))
          .min(2)
          .max(9)
      })
    )
    .min(1)
    .max(9)
})

export type GrokQuestionAnswerItem = {
  questionIndex: number
  choices: number[]
  labelSha256s: string[]
}

export type VerifiedGrokQuestion = {
  text: string
  multiSelect: boolean
  options: { label: string }[]
}

export function normalizeGrokQuestionAnswers(args: {
  choice?: number
  labelSha256?: string
  answers?: GrokQuestionAnswerItem[]
}): GrokQuestionAnswerItem[] {
  if (args.answers?.length) {
    return args.answers
  }
  if (args.choice !== undefined && args.labelSha256) {
    return [{ questionIndex: 1, choices: [args.choice], labelSha256s: [args.labelSha256] }]
  }
  throw new Error('invalid_argument')
}

function readRecords(path: string): Record<string, unknown>[] {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile()) {
      throw new Error('question_unverifiable')
    }
    const start = Math.max(0, stat.size - TAIL_BYTES)
    const buffer = Buffer.alloc(Math.min(stat.size, TAIL_BYTES))
    const count = readSync(fd, buffer, 0, buffer.length, start)
    if (count !== buffer.length) {
      throw new Error('question_unverifiable')
    }
    const lines = buffer.toString('utf8').split('\n')
    if (start > 0) {
      lines.shift()
    }
    if (lines.pop() !== '') {
      throw new Error('question_unverifiable')
    }
    return lines.filter((line) => line.trim()).map((line) => RecordSchema.parse(JSON.parse(line)))
  } finally {
    closeSync(fd)
  }
}

export function verifyGrokQuestionAnswer(args: {
  historyPath: string
  boundaryAt: number
  callId: string
  choice?: number
  labelSha256?: string
  answers?: GrokQuestionAnswerItem[]
}): VerifiedGrokQuestion[] {
  const events = readRecords(join(dirname(args.historyPath), 'events.jsonl'))
  let openQuestions = 0
  for (const event of events) {
    const time = typeof event.ts === 'string' ? Date.parse(event.ts) : Number.NaN
    if (!Number.isFinite(time) || time < args.boundaryAt) {
      continue
    }
    if (event.type === 'turn_started' || event.type === 'turn_ended') {
      openQuestions = 0
    }
    if (event.tool_name !== 'ask_user_question') {
      continue
    }
    if (event.type === 'tool_started') {
      openQuestions += 1
    }
    if (event.type === 'tool_completed') {
      openQuestions = Math.max(0, openQuestions - 1)
    }
  }
  if (openQuestions !== 1) {
    throw new Error('question_not_waiting')
  }
  const history = readRecords(args.historyPath)
  const callsByRecord = history.map((record) =>
    record.type === 'assistant' && Array.isArray(record.tool_calls)
      ? record.tool_calls
          .map((call) => CallSchema.parse(call))
          .filter((call) => call.name === 'ask_user_question')
      : []
  )
  for (let index = callsByRecord.length - 1; index >= 0; index -= 1) {
    const calls = callsByRecord[index]
    if (!calls.length) {
      continue
    }
    if (calls.length !== 1 || calls[0].id !== args.callId) {
      throw new Error('question_call_changed')
    }
    const raw = calls[0].arguments
    const parsed = QuestionSchema.parse(typeof raw === 'string' ? JSON.parse(raw) : raw).questions
    const answers = normalizeGrokQuestionAnswers(args)
    if (
      answers.length !== parsed.length ||
      answers.some((answer, index) => answer.questionIndex !== index + 1)
    ) {
      throw new Error('question_call_unverifiable')
    }
    const verified: VerifiedGrokQuestion[] = parsed.map((question, index) => {
      const multiSelect = question.multi_select === true || question.multiSelect === true
      const answer = answers[index]
      const uniqueChoices = new Set(answer.choices)
      if (
        uniqueChoices.size !== answer.choices.length ||
        (!multiSelect && answer.choices.length !== 1)
      ) {
        throw new Error('question_shape_unsupported')
      }
      for (let offset = 0; offset < answer.choices.length; offset += 1) {
        const option = question.options[answer.choices[offset] - 1]
        if (
          !option ||
          createHash('sha256').update(option.label, 'utf8').digest('hex') !==
            answer.labelSha256s[offset]
        ) {
          throw new Error('question_choice_changed')
        }
      }
      return {
        text: question.question,
        multiSelect,
        options: question.options.map((option) => ({ label: option.label }))
      }
    })
    // Why: a tool result may reach history before the completed event is flushed.
    const completedCalls = new Set(
      history
        .filter((row) => row.type === 'tool_result' || row.type === 'tool')
        .map((row) => row.tool_call_id)
    )
    for (const event of events) {
      if (event.type === 'tool_completed' && event.tool_name === 'ask_user_question') {
        completedCalls.add(event.tool_call_id)
      }
    }
    if (completedCalls.has(args.callId)) {
      throw new Error('question_already_completed')
    }
    const unresolvedCalls = callsByRecord.flatMap((calls) =>
      calls.filter((call) => !completedCalls.has(call.id))
    )
    if (unresolvedCalls.length !== 1 || unresolvedCalls[0].id !== args.callId) {
      throw new Error('question_call_unverifiable')
    }
    return verified
  }
  throw new Error('question_unverifiable')
}
