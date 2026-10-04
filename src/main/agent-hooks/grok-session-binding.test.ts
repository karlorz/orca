import { describe, expect, it } from 'vitest'
import type { AgentHookEventPayload } from '../../shared/agent-hook-listener/listener-event'
import type { GrokSessionTerminalOwner } from '../../shared/grok-session-binding'
import { observeGrokSessionBinding } from './grok-session-binding'

const owner: GrokSessionTerminalOwner = {
  runtimeId: 'runtime',
  executionHostId: 'local',
  handle: 'terminal',
  ptyId: 'pty',
  incarnationId: 'incarnation',
  paneKey: 'pane',
  tabId: 'tab',
  leafId: 'leaf',
  worktreeId: 'worktree',
  launchToken: 'launch'
}
const now = Date.now()
function event(overrides: Partial<AgentHookEventPayload> = {}): AgentHookEventPayload {
  return {
    source: 'grok',
    paneKey: owner.paneKey,
    tabId: owner.tabId,
    worktreeId: owner.worktreeId,
    connectionId: null,
    launchToken: owner.launchToken,
    providerSession: { key: 'session_id', id: 'session-first' },
    hookEventName: 'SessionStart',
    grokEventAt: now,
    payload: { state: 'done', prompt: '', agentType: 'grok' },
    ...overrides
  }
}
describe('live Grok session boundary evidence', () => {
  it('records SessionStart identity without fabricating a working status', () => {
    const incoming = event()
    expect(observeGrokSessionBinding(incoming, undefined, owner, now)).toMatchObject({
      sessionId: 'session-first',
      boundaryAt: now
    })
    expect(incoming.payload.state).toBe('done')
  })
  it.each([
    { grokEventAt: undefined },
    { grokEventAt: Number.NaN },
    { grokEventAt: now - 16_000 },
    { grokEventAt: now + 2000 },
    { launchToken: 'other' },
    { isReplay: true as const },
    { restoredUnconfirmed: true as const },
    { tabId: 'different' },
    { connectionId: 'ssh' },
    { providerSession: undefined }
  ])('refuses incomplete, stale, replayed or mismatched initial evidence %j', (overrides) => {
    expect(observeGrokSessionBinding(event(overrides), undefined, owner, now)).toBeUndefined()
  })
  it('establishes a live boundary from a waiting hook when SessionStart was missed', () => {
    expect(
      observeGrokSessionBinding(event({ hookEventName: 'PreToolUse' }), undefined, owner, now)
    ).toMatchObject({
      sessionId: 'session-first',
      boundaryAt: now,
      owner
    })
  })
  it('refuses a stale waiting hook instead of inventing a boundary', () => {
    expect(
      observeGrokSessionBinding(
        event({ hookEventName: 'PreToolUse', grokEventAt: now - 16_000 }),
        undefined,
        owner,
        now
      )
    ).toBeUndefined()
  })
  it('does not treat session end as a substitute for a live boundary', () => {
    expect(
      observeGrokSessionBinding(event({ hookEventName: 'SessionEnd' }), undefined, owner, now)
    ).toBeUndefined()
  })
  it('retains the new boundary while rejecting delayed old sessions', () => {
    const first = observeGrokSessionBinding(event(), undefined, owner, now)
    const second = observeGrokSessionBinding(
      event({ providerSession: { key: 'session_id', id: 'session-second' }, grokEventAt: now + 1 }),
      first,
      owner,
      now + 1
    )
    expect(second?.retiredSessionIds).toEqual(['session-first'])
    expect(
      observeGrokSessionBinding(event({ grokEventAt: now + 2 }), second, owner, now + 2)
    ).toEqual(second)
    expect(
      observeGrokSessionBinding(
        event({ hookEventName: 'PreToolUse', grokEventAt: now + 2 }),
        second,
        owner,
        now + 2
      )
    ).toEqual(second)
  })
  it('does not transfer a boundary to a replacement PTY incarnation', () => {
    const first = observeGrokSessionBinding(event(), undefined, owner, now)
    expect(
      observeGrokSessionBinding(
        event({ hookEventName: 'PreToolUse', grokEventAt: now + 1 }),
        first,
        { ...owner, incarnationId: 'replacement' },
        now + 1
      )
    ).toBeUndefined()
  })
  it('poisons ambiguous ordering until another observed session boundary', () => {
    const first = observeGrokSessionBinding(event(), undefined, owner, now)
    const ambiguous = observeGrokSessionBinding(
      event({ hookEventName: 'PreToolUse' }),
      first,
      owner,
      now
    )
    expect(ambiguous?.unverifiable).toBe(true)
    expect(
      observeGrokSessionBinding(
        event({ hookEventName: 'PreToolUse', grokEventAt: now + 1 }),
        ambiguous,
        owner,
        now + 1
      )?.unverifiable
    ).toBe(true)
  })
  it('revokes the binding on an observed session end', () => {
    const first = observeGrokSessionBinding(event(), undefined, owner, now)
    expect(
      observeGrokSessionBinding(
        event({ hookEventName: 'SessionEnd', grokEventAt: now + 1 }),
        first,
        owner,
        now + 1
      )
    ).toBeUndefined()
  })
})
