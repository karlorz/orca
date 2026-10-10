import { defineMethod } from '../../core'
import { setTimeout } from 'node:timers/promises'
import { agentHookServer } from '../../../../agent-hooks/server'
import { TerminalSessionNavigation } from '../../../terminal-session-navigation'
import { TerminalQuestionAnswer } from '../../../terminal-question-answer'
import { verifyGrokQuestionNavigationScreen } from '../../../grok-question-navigation-screen'
import { verifyGrokQuestionAnswer } from '../../../grok-question-answer-proof'
import { TerminalAnswerQuestion } from '../../../../../shared/rpc-contract/terminal-question-answer-params'
import { resolveGrokChatHistoryPathSync } from '../../../../../shared/grok-session-paths'
import { sameGrokSessionBinding } from '../../../../../shared/grok-session-binding'

const answers = new TerminalQuestionAnswer()

export const TERMINAL_QUESTION_ANSWER_METHODS = [
  defineMethod({
    name: 'terminal.answerQuestion',
    permission: 'workspace',
    params: TerminalAnswerQuestion,
    handler: async (params, { runtime, signal, clientKind }) => {
      if (clientKind !== undefined) {
        throw new Error('question_execution_host_required')
      }
      const navigation = new TerminalSessionNavigation({
        observations: () => agentHookServer.getGrokSessionObservations(),
        owner: (paneKey) => runtime.getSessionTerminalOwner(paneKey),
        reveal: (binding, stillCurrent) => runtime.revealSessionTerminal(binding, stillCurrent)
      })
      const binding = navigation.resolve(params.session)
      const terminal = await runtime.showTerminal(binding.handle)
      if (terminal.ptyId !== binding.ptyId || terminal.worktreeId !== binding.worktreeId) {
        throw new Error('session_binding_changed')
      }
      const historyPath = resolveGrokChatHistoryPathSync({
        sessionId: params.session,
        cwd: terminal.worktreePath
      })
      if (!historyPath) {
        throw new Error('question_unverifiable')
      }
      return {
        answer: await answers.answer(params, {
          resolve: () => navigation.resolve(params.session),
          verify: async (binding, content) => {
            const status = await runtime.getTerminalAgentStatus(binding.handle)
            if (!status.isRunningAgent || status.status !== 'permission') {
              throw new Error('question_not_waiting')
            }
            const screen = await runtime.readTerminal(binding.handle, { screen: true })
            verifyGrokQuestionNavigationScreen(screen.tail, content)
            if (signal?.aborted) {
              throw new Error('request_aborted')
            }
            if (runtime.getDriver(binding.ptyId).kind === 'mobile') {
              throw new Error('question_input_locked')
            }
            return verifyGrokQuestionAnswer({
              ...params,
              historyPath,
              boundaryAt: binding.boundaryAt
            })
          },
          send: async (binding, text, beforeWrite) => {
            const receipt = await runtime.sendTerminal(
              binding.handle,
              { text },
              {
                inputKind: 'driving',
                signal,
                beforeWrite,
                reserveWrite: (ptyId) => {
                  if (
                    signal?.aborted ||
                    ptyId !== binding.ptyId ||
                    !sameGrokSessionBinding(navigation.resolve(params.session), binding)
                  ) {
                    throw new Error('session_binding_changed')
                  }
                  if (runtime.getDriver(ptyId).kind === 'mobile') {
                    throw new Error('question_input_locked')
                  }
                  verifyGrokQuestionAnswer({
                    ...params,
                    historyPath,
                    boundaryAt: binding.boundaryAt
                  })
                }
              }
            )
            if ((text === '\u0015' || text === 'l') && receipt.accepted) {
              await setTimeout(50, undefined, { signal })
            }
            return receipt
          }
        })
      }
    }
  })
]
