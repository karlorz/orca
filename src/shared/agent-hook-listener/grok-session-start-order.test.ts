import { describe, expect, it } from 'vitest'
import type { AgentHookEventPayload } from './listener-event'
import { isLateGrokSessionStart } from './grok-session-start-order'

const turn: AgentHookEventPayload = {
  source: 'grok',
  paneKey: 'tab:leaf',
  tabId: 'tab',
  worktreeId: 'workspace',
  connectionId: null,
  launchToken: 'launch',
  hookEventName: 'UserPromptSubmit',
  grokPromptBoundary: true,
  providerSession: { key: 'session_id', id: 'session' },
  payload: { state: 'working', prompt: 'report', agentType: 'grok' }
}
const startup = { ...turn, hookEventName: 'SessionStart', grokPromptBoundary: undefined }

describe('Grok startup arriving after its prompt', () => {
  it.each(['SessionStart', 'session_start'])(
    'recognizes %s only for the same observed launch and session',
    (hookEventName) => {
      expect(isLateGrokSessionStart(turn, { ...startup, hookEventName })).toBe(true)
    }
  )

  it.each([
    { source: 'codex' },
    { hookEventName: 'UserPromptSubmit' },
    { paneKey: 'other:leaf' },
    { tabId: 'other' },
    { worktreeId: 'other-workspace' },
    { connectionId: 'other-host' },
    { launchToken: 'new-launch' },
    { launchToken: undefined },
    { providerSession: { key: 'session_id', id: 'other-session' } },
    { providerSession: undefined }
  ] satisfies Partial<AgentHookEventPayload>[])(
    'does not suppress a new or unproven owner %#',
    (change) => expect(isLateGrokSessionStart(turn, { ...startup, ...change })).toBe(false)
  )

  it.each([
    { source: 'codex' },
    { grokPromptBoundary: undefined },
    { providerSessionOnly: true },
    { restoredUnconfirmed: true },
    { isReplay: true },
    { agentPresence: { agent: 'grok', ended: true } }
  ] satisfies Partial<AgentHookEventPayload>[])(
    'does not preserve stale or unattributed prior state %#',
    (change) => expect(isLateGrokSessionStart({ ...turn, ...change }, startup)).toBe(false)
  )
})
