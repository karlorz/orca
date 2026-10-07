import { describe, expect, it } from 'vitest'
import { automationAgentCompletionResult } from './automation-agent-completion-result'

describe('automation agent completion verdict', () => {
  it.each(['failure', 'cancellation', 'superseded', 'interruption', 'unconfirmed'] as const)(
    'does not mark %s completed',
    (outcome) => {
      expect(
        automationAgentCompletionResult({ state: 'done', mainAgent: { state: 'done', outcome } })
      ).toEqual({ status: 'dispatch_failed', error: expect.any(String) })
    }
  )

  it('honors a legacy cancellation', () => {
    expect(automationAgentCompletionResult({ state: 'done', interrupted: true }).status).toBe(
      'dispatch_failed'
    )
  })

  it('retains compatibility for a provider that supplies no verdict', () => {
    expect(automationAgentCompletionResult({ state: 'done' })).toEqual({
      status: 'completed',
      error: null
    })
  })

  it('accepts an explicit success', () => {
    expect(
      automationAgentCompletionResult({
        state: 'done',
        mainAgent: { state: 'done', outcome: 'success' }
      })
    ).toEqual({ status: 'completed', error: null })
  })
})
