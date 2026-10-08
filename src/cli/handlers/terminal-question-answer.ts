import type { CommandHandler } from '../dispatch'
import { getOptionalStringFlag, getRequiredStringFlag } from '../flags'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import { TERMINAL_QUESTION_ANSWER_RUNTIME_CAPABILITY } from '../../shared/terminal-navigation-runtime-capabilities'

export const terminalQuestionAnswerHandler: CommandHandler = async ({ flags, client, json }) => {
  const provider = getRequiredStringFlag(flags, 'provider')
  const session = getRequiredStringFlag(flags, 'session')
  const callId = getRequiredStringFlag(flags, 'call')
  const answersText = getOptionalStringFlag(flags, 'answers')
  const choiceText = getOptionalStringFlag(flags, 'choice')
  const labelSha256 = getOptionalStringFlag(flags, 'label-sha256')
  if (provider !== 'grok') {
    throw new RuntimeClientError('invalid_argument', 'Invalid Grok question answer.')
  }
  const params: Record<string, unknown> = { provider, session, callId }
  if (answersText) {
    if (choiceText || labelSha256) {
      throw new RuntimeClientError('invalid_argument', 'Invalid Grok question answer.')
    }
    try {
      params.answers = JSON.parse(answersText)
    } catch {
      throw new RuntimeClientError('invalid_argument', 'Invalid Grok question answer.')
    }
  } else if (
    choiceText &&
    labelSha256 &&
    /^[1-9]$/.test(choiceText) &&
    /^[a-f0-9]{64}$/.test(labelSha256)
  ) {
    params.choice = Number(choiceText)
    params.labelSha256 = labelSha256
  } else {
    throw new RuntimeClientError('invalid_argument', 'Invalid Grok question answer.')
  }
  const status = await client.getCliStatus()
  if (!status.result.runtime.capabilities?.includes(TERMINAL_QUESTION_ANSWER_RUNTIME_CAPABILITY)) {
    throw new RuntimeClientError(
      'question_answer_unavailable',
      'This Orca host does not support verified question answers.'
    )
  }
  const result = await client.call('terminal.answerQuestion', params)
  printResult(
    result,
    json,
    () => 'Question selection accepted; Grok completion remains to be confirmed.'
  )
}
