import { describe, expect, it } from 'vitest'
import { normalizeHookPayload } from './agent-hook-listener'
import { createHookListenerState } from './agent-hook-listener/listener-state'
import { PANE_KEY } from './agent-hook-listener-test-harness'

describe('Grok shutdown preserves the finished turn verdict', () => {
  it.each(['StopFailure', 'StopCancelled'])(
    'keeps %s through SessionEnd and the trailing shutdown Stop',
    (hookEventName) => {
      const state = createHookListenerState()
      const normalize = (payload: Record<string, unknown>) =>
        normalizeHookPayload(state, 'grok', { paneKey: PANE_KEY, payload }, 'production')?.payload
      normalize({
        hookEventName: 'UserPromptSubmit',
        sessionId: 's-1',
        promptId: 'p-1',
        prompt: 'review'
      })
      normalize({ hookEventName, sessionId: 's-1', promptId: 'p-1' })
      normalize({ hookEventName: 'SessionEnd', reason: 'shutdown', sessionId: 's-1' })
      expect(
        normalize({ hookEventName: 'Stop', reason: 'shutdown', sessionId: 's-1' })
      ).toMatchObject({
        sessionBoundary: true,
        mainAgent: {
          state: 'done',
          outcome: hookEventName === 'StopFailure' ? 'failure' : 'cancellation'
        }
      })
      normalize({
        hookEventName: 'UserPromptSubmit',
        sessionId: 's-1',
        promptId: 'p-2',
        prompt: 'next'
      })
      expect(
        normalize({ hookEventName: 'Stop', sessionId: 's-1', promptId: 'p-2' })?.mainAgent?.outcome
      ).toBeUndefined()
    }
  )
})
