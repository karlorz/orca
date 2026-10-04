import { z } from 'zod'
import { TerminalResolveSession } from './terminal-session-navigation-params'

const QuestionAnswerItem = z
  .object({
    questionIndex: z.number().int().min(1).max(9),
    choices: z.array(z.number().int().min(1).max(9)).min(1).max(9),
    labelSha256s: z
      .array(z.string().regex(/^[a-f0-9]{64}$/))
      .min(1)
      .max(9)
  })
  .refine((row) => row.choices.length === row.labelSha256s.length, {
    message: 'invalid_argument'
  })

export const TerminalAnswerQuestion = TerminalResolveSession.extend({
  callId: z.string().min(1).max(512),
  choice: z.number().int().min(1).max(9).optional(),
  labelSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  answers: z.array(QuestionAnswerItem).min(1).max(9).optional()
}).refine(
  (value) => {
    const hasLegacy = value.choice !== undefined && value.labelSha256 !== undefined
    const hasAnswers = value.answers !== undefined
    return (hasLegacy && !hasAnswers) || (!hasLegacy && hasAnswers)
  },
  { message: 'invalid_argument' }
)
